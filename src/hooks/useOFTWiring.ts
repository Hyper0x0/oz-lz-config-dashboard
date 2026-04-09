import { useCallback } from 'react';
import { Contract, JsonRpcProvider, JsonRpcSigner, BrowserProvider, ContractRunner } from 'ethers';

/** Provider with staticNetwork to skip auto-detection retry loops */
function staticProvider(rpc: string): JsonRpcProvider {
  return new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
}
import OFTAdapterABI from '@/abis/evm/OFTAdapter.json';
import OFTABI from '@/abis/evm/OFT.json';
import ERC20ABI from '@/abis/evm/ERC20.json';
import type { TxState, AdapterState, PeerState, EnforcedOptionParam, IOFTAdapter, IOFTPeer, IERC20Read, TokenInfo, PeerEntry } from '@/types';
import { buildLzReceiveOption } from '@/utils/lzOptions';
import { decodeContractError, extractErrorDetails } from '@/utils/decodeError';

const SEND_MSG_TYPE = 1;

interface OFTWiring {
  readTokenInfo: (adapterAddr: string, peerAddr: string, homeRpc: string, remoteRpc: string, walletProvider?: BrowserProvider, remoteWalletProvider?: BrowserProvider) => Promise<TokenInfo>;
  /** Read name + symbol from a single EVM OFT or Adapter. For adapters, follows token() first. */
  readEvmSideInfo: (addr: string, rpc: string, isAdapterSide: boolean, walletProvider?: BrowserProvider) => Promise<{ name: string; symbol: string }>;
  readAdapterState: (adapterAddr: string, peerEid: number, homeRpc: string) => Promise<AdapterState>;
  readPeerState: (peerAddr: string, adapterEid: number, remoteRpc: string) => Promise<PeerState>;
  /** Query peers(eid) for every entry in eidList and return results. Zero bytes32 = null. */
  readAllPeers: (bridgeAddr: string, homeRpc: string, eidList: Array<{ eid: number; name: string }>, walletProvider?: BrowserProvider) => Promise<PeerEntry[]>;
  setEvmPeer: (contractAddr: string, peerEid: number, peerAddr: string) => Promise<TxState>;
  setEvmEnforcedOptions: (contractAddr: string, peerEid: number, gas: bigint) => Promise<TxState>;
  setRateLimit: (adapterAddr: string, dstEid: number, limit: bigint, window: number) => Promise<TxState>;
  setDelegate: (contractAddr: string, delegate: string) => Promise<TxState>;
  /** Detect whether an EVM address is an OFTAdapter (token() !== self) or OFT (token() === self). */
  detectOFTType: (addr: string, rpc: string, walletProvider?: BrowserProvider) => Promise<'adapter' | 'oft'>;
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
    async (adapterAddr: string, peerAddr: string, homeRpc: string, remoteRpc: string, walletProvider?: BrowserProvider, remoteWalletProvider?: BrowserProvider): Promise<TokenInfo> => {
      const homeProvider = walletProvider ?? staticProvider(homeRpc);
      const remoteProvider = remoteWalletProvider ?? staticProvider(remoteRpc);
      const adapter = adapterContract(adapterAddr, homeProvider);
      const peer = peerContract(peerAddr, remoteProvider);

      const tokenAddr = await adapter.token();
      const erc20 = new Contract(tokenAddr, ERC20ABI, homeProvider) as unknown as IERC20Read;

      const [tokenName, tokenSymbol, peerName, peerSymbol] = await Promise.all([
        erc20.name(),
        erc20.symbol(),
        peer.name(),
        peer.symbol(),
      ]);
      return { tokenName, tokenSymbol, peerName, peerSymbol };
    },
    [],
  );

  const readEvmSideInfo = useCallback(
    async (addr: string, rpc: string, isAdapterSide: boolean, walletProvider?: BrowserProvider): Promise<{ name: string; symbol: string }> => {
      const provider = walletProvider ?? staticProvider(rpc);
      if (isAdapterSide) {
        const adapter = adapterContract(addr, provider);
        const tokenAddr = await adapter.token();
        const erc20 = new Contract(tokenAddr, ERC20ABI, provider) as unknown as IERC20Read;
        const [name, symbol] = await Promise.all([erc20.name(), erc20.symbol()]);
        return { name, symbol };
      }
      const oft = peerContract(addr, provider);
      const [name, symbol] = await Promise.all([oft.name(), oft.symbol()]);
      return { name, symbol };
    },
    [],
  );

  const readAdapterState = useCallback(
    async (adapterAddr: string, peerEid: number, homeRpc: string): Promise<AdapterState> => {
      const provider = staticProvider(homeRpc);
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
    async (peerAddr: string, adapterEid: number, remoteRpc: string): Promise<PeerState> => {
      const provider = staticProvider(remoteRpc);
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
    async (bridgeAddr: string, homeRpc: string, eidList: Array<{ eid: number; name: string }>, walletProvider?: BrowserProvider): Promise<PeerEntry[]> => {
      const provider = walletProvider ?? staticProvider(homeRpc);
      const c = adapterContract(bridgeAddr, provider);
      const settled = await Promise.allSettled(eidList.map((item) => c.peers(item.eid)));
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
    async (addr: string, rpc: string, walletProvider?: BrowserProvider): Promise<'adapter' | 'oft'> => {
      const provider = walletProvider ?? staticProvider(rpc);
      const c = new Contract(addr, ['function token() view returns (address)'], provider);
      const tokenAddr = await c.token() as string;
      return tokenAddr.toLowerCase() === addr.toLowerCase() ? 'oft' : 'adapter';
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
