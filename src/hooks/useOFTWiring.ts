import { useCallback } from 'react';
import { Contract, JsonRpcProvider, JsonRpcSigner, BrowserProvider, ContractRunner, Network } from 'ethers';

/**
 * Provider with staticNetwork to skip auto-detection retry loops.
 * When chainId is provided, the network is bound up-front so ethers never makes an
 * eth_chainId round-trip — critical for slow public RPCs that otherwise stall every call.
 */
function staticProvider(rpc: string, chainId?: number): JsonRpcProvider {
  if (chainId !== undefined) {
    const net = Network.from(chainId);
    return new JsonRpcProvider(rpc, net, { staticNetwork: net });
  }
  return new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
}

/** Run a list of async tasks with bounded concurrency. Used to avoid hammering public RPCs. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = { status: 'fulfilled', value: await fn(items[i], i) }; }
      catch (reason) { results[i] = { status: 'rejected', reason }; }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Try once, then retry once after a short delay if it throws. Catches transient RPC rate limits. */
async function withRetry<T>(fn: () => Promise<T>, delayMs = 250): Promise<T> {
  try { return await fn(); }
  catch {
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}
import OFTAdapterABI from '@/abis/evm/OFTAdapter.json';
import OFTABI from '@/abis/evm/OFT.json';
import ERC20ABI from '@/abis/evm/ERC20.json';
import type { TxState, AdapterState, PeerState, EnforcedOptionParam, IOFTAdapter, IOFTPeer, IERC20Read, TokenInfo, PeerEntry } from '@/types';
import { buildLzReceiveOption } from '@/utils/lzOptions';
import { decodeContractError, extractErrorDetails } from '@/utils/decodeError';

const SEND_MSG_TYPE = 1;

interface OFTWiring {
  readTokenInfo: (adapterAddr: string, peerAddr: string, homeRpc: string, remoteRpc: string, walletProvider?: BrowserProvider, remoteWalletProvider?: BrowserProvider, homeChainId?: number, remoteChainId?: number) => Promise<TokenInfo>;
  /** Read name + symbol from a single EVM OFT or Adapter. For adapters, follows token() first. */
  readEvmSideInfo: (addr: string, rpc: string, isAdapterSide: boolean, walletProvider?: BrowserProvider, chainId?: number) => Promise<{ name: string; symbol: string }>;
  readAdapterState: (adapterAddr: string, peerEid: number, homeRpc: string, homeChainId?: number) => Promise<AdapterState>;
  readPeerState: (peerAddr: string, adapterEid: number, remoteRpc: string, remoteChainId?: number) => Promise<PeerState>;
  /** Query peers(eid) for every entry in eidList and return results. Zero bytes32 = null. */
  readAllPeers: (bridgeAddr: string, homeRpc: string, eidList: Array<{ eid: number; name: string }>, walletProvider?: BrowserProvider, chainId?: number) => Promise<PeerEntry[]>;
  setEvmPeer: (contractAddr: string, peerEid: number, peerAddr: string) => Promise<TxState>;
  setEvmEnforcedOptions: (contractAddr: string, peerEid: number, gas: bigint) => Promise<TxState>;
  setRateLimit: (adapterAddr: string, dstEid: number, limit: bigint, window: number) => Promise<TxState>;
  setDelegate: (contractAddr: string, delegate: string) => Promise<TxState>;
  /** Detect whether an EVM address is an OFTAdapter (token() !== self) or OFT (token() === self). */
  detectOFTType: (addr: string, rpc: string, walletProvider?: BrowserProvider, chainId?: number) => Promise<'adapter' | 'oft'>;
  /** Quote the LZ fee for a send */
  quoteSend: (oftAddr: string, dstEid: number, toBytes32: string, amountLD: bigint, minAmountLD: bigint) => Promise<{ nativeFee: bigint; lzTokenFee: bigint }>;
  /** Execute an OFT cross-chain send (EVM). For adapters, approve first. */
  evmSend: (oftAddr: string, dstEid: number, toBytes32: string, amountLD: bigint, minAmountLD: bigint, fee: { nativeFee: bigint; lzTokenFee: bigint }) => Promise<TxState>;
  /** Approve ERC20 tokens for the OFTAdapter lockbox */
  approveToken: (tokenAddr: string, spender: string, amount: bigint) => Promise<TxState>;
  /** Read ERC20 balance + allowance for the connected wallet */
  readTokenBalance: (tokenAddr: string, owner: string, spender: string) => Promise<{ balance: bigint; allowance: bigint; decimals: number }>;
}

function adapterContract(addr: string, signerOrProvider: ContractRunner): IOFTAdapter {
  return new Contract(addr, OFTAdapterABI, signerOrProvider) as unknown as IOFTAdapter;
}

function peerContract(addr: string, signerOrProvider: ContractRunner): IOFTPeer {
  return new Contract(addr, OFTABI, signerOrProvider) as unknown as IOFTPeer;
}

export function useOFTWiring(evmSigner: JsonRpcSigner | null): OFTWiring {
  // ── Read ──────────────────────────────────────────────────────────────────

  const readTokenInfo = useCallback(
    async (adapterAddr: string, peerAddr: string, homeRpc: string, remoteRpc: string, walletProvider?: BrowserProvider, remoteWalletProvider?: BrowserProvider, homeChainId?: number, remoteChainId?: number): Promise<TokenInfo> => {
      const homeProvider = walletProvider ?? staticProvider(homeRpc, homeChainId);
      const remoteProvider = remoteWalletProvider ?? staticProvider(remoteRpc, remoteChainId);

      // For adapters, name/symbol live on the underlying ERC20 reached via token().
      // For pure OFTs, token() either returns self or doesn't exist — read directly from the OFT.
      // Some OFTs don't inherit ERC20 at all and revert on name()/symbol(), so each call is wrapped.
      async function readName(addr: string, provider: ContractRunner): Promise<{ name: string; symbol: string }> {
        let tokenAddr = addr;
        try {
          const adapter = adapterContract(addr, provider);
          const t = await adapter.token() as string;
          if (t && t.toLowerCase() !== addr.toLowerCase()) tokenAddr = t;
        } catch { /* not an adapter — read from the OFT itself */ }
        const erc20 = new Contract(tokenAddr, ERC20ABI, provider) as unknown as IERC20Read;
        const [nameRes, symbolRes] = await Promise.allSettled([erc20.name(), erc20.symbol()]);
        return {
          name: nameRes.status === 'fulfilled' ? (nameRes.value as string) : `${tokenAddr.slice(0, 10)}…`,
          symbol: symbolRes.status === 'fulfilled' ? (symbolRes.value as string) : '',
        };
      }

      const [home, peer] = await Promise.all([
        readName(adapterAddr, homeProvider),
        readName(peerAddr, remoteProvider),
      ]);
      return { tokenName: home.name, tokenSymbol: home.symbol, peerName: peer.name, peerSymbol: peer.symbol };
    },
    [],
  );

  const readEvmSideInfo = useCallback(
    async (addr: string, rpc: string, isAdapterSide: boolean, walletProvider?: BrowserProvider, chainId?: number): Promise<{ name: string; symbol: string }> => {
      const provider = walletProvider ?? staticProvider(rpc, chainId);
      // Resolve target: adapter follows token(); OFT reads directly. Each call is wrapped so a missing
      // getter on a non-ERC20 OFT doesn't reject the whole fetch.
      let tokenAddr = addr;
      if (isAdapterSide) {
        try {
          const adapter = adapterContract(addr, provider);
          const t = await adapter.token() as string;
          if (t && t.toLowerCase() !== addr.toLowerCase()) tokenAddr = t;
        } catch { /* not actually an adapter — read directly */ }
      }
      const erc20 = new Contract(tokenAddr, ERC20ABI, provider) as unknown as IERC20Read;
      const [nameRes, symbolRes] = await Promise.allSettled([erc20.name(), erc20.symbol()]);
      return {
        name: nameRes.status === 'fulfilled' ? (nameRes.value as string) : `${tokenAddr.slice(0, 10)}…`,
        symbol: symbolRes.status === 'fulfilled' ? (symbolRes.value as string) : '',
      };
    },
    [],
  );

  const readAdapterState = useCallback(
    async (adapterAddr: string, peerEid: number, homeRpc: string, homeChainId?: number): Promise<AdapterState> => {
      const provider = staticProvider(homeRpc, homeChainId);
      const c = adapterContract(adapterAddr, provider);
      const [owner, token, peer, opts] = await Promise.all([
        c.owner(),
        c.token(),
        c.peers(peerEid),
        c.enforcedOptions(peerEid, SEND_MSG_TYPE),
      ]);

      // rateLimits() and getAmountCanBeSent() only exist on OFTMintBurnAdapter, not standard OFTs
      let rateLimit = { amountInFlight: 0n, lastUpdated: 0, limit: 0n, window: 0 };
      let amountInFlight = 0n;
      let amountCanBeSent = 0n;
      try {
        const [rl, flight] = await Promise.all([
          c.rateLimits(peerEid),
          c.getAmountCanBeSent(peerEid),
        ]);
        rateLimit = { amountInFlight: rl[0], lastUpdated: Number(rl[1]), limit: rl[2], window: Number(rl[3]) };
        amountInFlight = flight[0];
        amountCanBeSent = flight[1];
      } catch { /* standard OFT — no rate limits */ }

      return {
        owner,
        token,
        peer,
        enforcedOptionsSend: opts,
        rateLimit,
        amountInFlight,
        amountCanBeSent,
      };
    },
    [],
  );

  const readPeerState = useCallback(
    async (peerAddr: string, adapterEid: number, remoteRpc: string, remoteChainId?: number): Promise<PeerState> => {
      const provider = staticProvider(remoteRpc, remoteChainId);
      const c = peerContract(peerAddr, provider);
      const [owner, peer, opts] = await Promise.all([
        c.owner(),
        c.peers(adapterEid),
        c.enforcedOptions(adapterEid, SEND_MSG_TYPE),
      ]);
      return { owner, peer, enforcedOptionsSend: opts };
    },
    [],
  );

  const readAllPeers = useCallback(
    async (bridgeAddr: string, homeRpc: string, eidList: Array<{ eid: number; name: string }>, walletProvider?: BrowserProvider, chainId?: number): Promise<PeerEntry[]> => {
      const provider = walletProvider ?? staticProvider(homeRpc, chainId);
      const c = adapterContract(bridgeAddr, provider);
      // Bounded concurrency + single retry — public RPCs throttle dozens of parallel calls,
      // which previously dropped random entries (often the Stark one at the tail of the array).
      const settled = await mapLimit(eidList, 4, (item) => withRetry(() => c.peers(item.eid)));
      const ZERO = /^0x0+$/;
      return eidList.map((item, i) => {
        const res = settled[i];
        if (res.status === 'rejected') return { ...item, peer: null, error: true };
        const bytes32 = res.value as string;
        return { ...item, peer: ZERO.test(bytes32) ? null : bytes32 };
      });
    },
    [],
  );

  // ── Write — EVM ───────────────────────────────────────────────────────────

  const setEvmPeer = useCallback(
    async (contractAddr: string, peerEid: number, peerAddr: string): Promise<TxState> => {
      if (!evmSigner) return { status: 'error', message: 'Wallet not connected' };
      const peerBytes32 = '0x' + BigInt(peerAddr).toString(16).padStart(64, '0');
      try {
        // Both adapter and peer expose the same setPeer interface
        const c = adapterContract(contractAddr, evmSigner);
        const tx = await c.setPeer(peerEid, peerBytes32);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: decodeContractError(err), details: extractErrorDetails(err, { contractAddr, functionName: 'setPeer', functionCall: `setPeer(${peerEid}, ${peerBytes32})` }) };
      }
    },
    [evmSigner],
  );

  const setEvmEnforcedOptions = useCallback(
    async (contractAddr: string, peerEid: number, gas: bigint): Promise<TxState> => {
      if (!evmSigner) return { status: 'error', message: 'Wallet not connected' };
      const opts = buildLzReceiveOption(gas);
      const param: EnforcedOptionParam = { eid: peerEid, msgType: SEND_MSG_TYPE, options: opts };
      try {
        const c = adapterContract(contractAddr, evmSigner);
        const tx = await c.setEnforcedOptions([param]);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: decodeContractError(err), details: extractErrorDetails(err, { contractAddr, functionName: 'setEnforcedOptions', functionCall: `setEnforcedOptions([{ eid: ${peerEid}, msgType: ${SEND_MSG_TYPE}, options: "${opts}" }])` }) };
      }
    },
    [evmSigner],
  );

  const setRateLimit = useCallback(
    async (adapterAddr: string, dstEid: number, limit: bigint, window: number): Promise<TxState> => {
      if (!evmSigner) return { status: 'error', message: 'Wallet not connected' };
      try {
        const c = adapterContract(adapterAddr, evmSigner);
        const tx = await c.setRateLimits([{ dstEid, limit, window }]);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: decodeContractError(err), details: extractErrorDetails(err, { contractAddr: adapterAddr, functionName: 'setRateLimits', functionCall: `setRateLimits([{ dstEid: ${dstEid}, limit: ${limit}, window: ${window} }])` }) };
      }
    },
    [evmSigner],
  );

  const setDelegate = useCallback(
    async (contractAddr: string, delegate: string): Promise<TxState> => {
      if (!evmSigner) return { status: 'error', message: 'Wallet not connected' };
      try {
        const c = adapterContract(contractAddr, evmSigner);
        const tx = await c.setDelegate(delegate);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: decodeContractError(err), details: extractErrorDetails(err, { contractAddr, functionName: 'setDelegate', functionCall: `setDelegate(${delegate})` }) };
      }
    },
    [evmSigner],
  );

  const detectOFTType = useCallback(
    async (addr: string, rpc: string, walletProvider?: BrowserProvider, chainId?: number): Promise<'adapter' | 'oft'> => {
      const provider = walletProvider ?? staticProvider(rpc, chainId);
      const c = new Contract(addr, ['function token() view returns (address)'], provider);
      try {
        const tokenAddr = await c.token() as string;
        // Adapter: token() returns a distinct ERC20. Pure OFT: token() returns self (or reverts).
        return tokenAddr.toLowerCase() === addr.toLowerCase() ? 'oft' : 'adapter';
      } catch {
        // token() not present / reverted — standard pure OFT.
        return 'oft';
      }
    },
    [],
  );

  // ── Send / Transfer ────────────────────────────────────────────────────────

  const quoteSend = useCallback(
    async (oftAddr: string, dstEid: number, toBytes32: string, amountLD: bigint, minAmountLD: bigint) => {
      if (!evmSigner) throw new Error('Wallet not connected');
      const c = new Contract(oftAddr, OFTABI, evmSigner);
      const sendParam = { dstEid, to: toBytes32, amountLD, minAmountLD, extraOptions: '0x', composeMsg: '0x', oftCmd: '0x' };
      const fee = await c.quoteSend(sendParam, false);
      return { nativeFee: fee.nativeFee as bigint, lzTokenFee: fee.lzTokenFee as bigint };
    },
    [evmSigner],
  );

  const evmSend = useCallback(
    async (oftAddr: string, dstEid: number, toBytes32: string, amountLD: bigint, minAmountLD: bigint, fee: { nativeFee: bigint; lzTokenFee: bigint }): Promise<TxState> => {
      if (!evmSigner) return { status: 'error', message: 'Wallet not connected' };
      try {
        const c = new Contract(oftAddr, OFTABI, evmSigner);
        const sendParam = { dstEid, to: toBytes32, amountLD, minAmountLD, extraOptions: '0x', composeMsg: '0x', oftCmd: '0x' };
        const refundAddr = await evmSigner.getAddress();
        const tx = await c.send(sendParam, fee, refundAddr, { value: fee.nativeFee });
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: decodeContractError(err), details: extractErrorDetails(err, { contractAddr: oftAddr, functionName: 'send', functionCall: `send({ dstEid: ${dstEid}, to: ${toBytes32}, amountLD: ${amountLD}, minAmountLD: ${minAmountLD} }, { nativeFee: ${fee.nativeFee}, lzTokenFee: ${fee.lzTokenFee} }, refundAddr)` }) };
      }
    },
    [evmSigner],
  );

  const approveToken = useCallback(
    async (tokenAddr: string, spender: string, amount: bigint): Promise<TxState> => {
      if (!evmSigner) return { status: 'error', message: 'Wallet not connected' };
      try {
        const c = new Contract(tokenAddr, ERC20ABI, evmSigner);
        const tx = await c.approve(spender, amount);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: decodeContractError(err), details: extractErrorDetails(err, { contractAddr: tokenAddr, functionName: 'approve', functionCall: `approve(${spender}, ${amount})` }) };
      }
    },
    [evmSigner],
  );

  const readTokenBalance = useCallback(
    async (tokenAddr: string, owner: string, spender: string) => {
      if (!evmSigner) throw new Error('Wallet not connected');
      const c = new Contract(tokenAddr, ERC20ABI, evmSigner);
      const [balance, allowance, decimals] = await Promise.all([
        c.balanceOf(owner) as Promise<bigint>,
        c.allowance(owner, spender) as Promise<bigint>,
        c.decimals() as Promise<bigint>,
      ]);
      return { balance, allowance, decimals: Number(decimals) };
    },
    [evmSigner],
  );

  return {
    readTokenInfo,
    readEvmSideInfo,
    readAdapterState,
    readPeerState,
    readAllPeers,
    setEvmPeer,
    setEvmEnforcedOptions,
    setRateLimit,
    setDelegate,
    detectOFTType,
    quoteSend,
    evmSend,
    approveToken,
    readTokenBalance,
  };
}
