import { useCallback } from 'react';
import { Contract, JsonRpcProvider, JsonRpcSigner, BrowserProvider, ContractRunner } from 'ethers';
import OFTAdapterABI from '@/abis/OFTAdapter.json';
import OFTABI from '@/abis/OFT.json';
import ERC20ABI from '@/abis/ERC20.json';
import type { TxState, AdapterState, PeerState, EnforcedOptionParam, IOFTAdapter, IOFTPeer, IERC20Read, TokenInfo, PeerEntry } from '@/types';
import { buildLzReceiveOption } from '@/utils/lzOptions';
import { feltToBytes32, evmToFelt } from '@/utils/cairoAddress';

const SEND_MSG_TYPE = 1;

interface OFTWiring {
  readTokenInfo: (adapterAddr: string, peerAddr: string, homeRpc: string, remoteRpc: string, walletProvider?: BrowserProvider) => Promise<TokenInfo>;
  /** Read name + symbol from a single EVM OFT or Adapter. For adapters, follows token() first. */
  readEvmSideInfo: (addr: string, rpc: string, isAdapterSide: boolean) => Promise<{ name: string; symbol: string }>;
  readAdapterState: (adapterAddr: string, peerEid: number, homeRpc: string) => Promise<AdapterState>;
  readPeerState: (peerAddr: string, adapterEid: number, remoteRpc: string) => Promise<PeerState>;
  /** Query peers(eid) for every entry in eidList and return results. Zero bytes32 = null. */
  readAllPeers: (bridgeAddr: string, homeRpc: string, eidList: Array<{ eid: number; name: string }>) => Promise<PeerEntry[]>;
  setEvmPeer: (contractAddr: string, peerEid: number, peerAddr: string) => Promise<TxState>;
  setEvmPeerToCairo: (adapterAddr: string, cairoEid: number, cairoAddrFelt: string) => Promise<TxState>;
  setEvmEnforcedOptions: (contractAddr: string, peerEid: number, gas: bigint) => Promise<TxState>;
  setRateLimit: (adapterAddr: string, dstEid: number, limit: bigint, window: number) => Promise<TxState>;
  setDelegate: (contractAddr: string, delegate: string) => Promise<TxState>;
  /** TODO: implement when Cairo OFT contracts are deployed. */
  setCairoPeer: (cairoOftAddr: string, adapterEid: number, adapterEvmAddr: string) => Promise<TxState>;
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
    async (adapterAddr: string, peerAddr: string, homeRpc: string, remoteRpc: string, walletProvider?: BrowserProvider): Promise<TokenInfo> => {
      const homeProvider = walletProvider ?? new JsonRpcProvider(homeRpc);
      const remoteProvider = new JsonRpcProvider(remoteRpc);
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
    async (addr: string, rpc: string, isAdapterSide: boolean): Promise<{ name: string; symbol: string }> => {
      const provider = new JsonRpcProvider(rpc);
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
      const provider = new JsonRpcProvider(homeRpc);
      const c = adapterContract(adapterAddr, provider);
      const [owner, token, peer, opts, rl, flight] = await Promise.all([
        c.owner(),
        c.token(),
        c.peers(peerEid),
        c.enforcedOptions(peerEid, SEND_MSG_TYPE),
        c.rateLimits(peerEid),
        c.getAmountCanBeSent(peerEid),
      ]);
      return {
        owner,
        token,
        peer,
        enforcedOptionsSend: opts,
        rateLimit: {
          amountInFlight: rl[0],
          lastUpdated: Number(rl[1]),
          limit: rl[2],
          window: Number(rl[3]),
        },
        amountInFlight: flight[0],
        amountCanBeSent: flight[1],
      };
    },
    [],
  );

  const readPeerState = useCallback(
    async (peerAddr: string, adapterEid: number, remoteRpc: string): Promise<PeerState> => {
      const provider = new JsonRpcProvider(remoteRpc);
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
    async (bridgeAddr: string, homeRpc: string, eidList: Array<{ eid: number; name: string }>): Promise<PeerEntry[]> => {
      const provider = new JsonRpcProvider(homeRpc);
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
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
      }
    },
    [evmSigner],
  );

  const setEvmPeerToCairo = useCallback(
    async (adapterAddr: string, cairoEid: number, cairoAddrFelt: string): Promise<TxState> => {
      if (!evmSigner) return { status: 'error', message: 'Wallet not connected' };
      const peerBytes32 = feltToBytes32(evmToFelt(cairoAddrFelt));
      try {
        const c = adapterContract(adapterAddr, evmSigner);
        const tx = await c.setPeer(cairoEid, peerBytes32);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
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
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
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
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
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
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
      }
    },
    [evmSigner],
  );

  // ── Cairo side (scaffold) ─────────────────────────────────────────────────

  const setCairoPeer = useCallback(
    async (_cairoOftAddr: string, _adapterEid: number, _adapterEvmAddr: string): Promise<TxState> => {
      // TODO: implement when Cairo OFT ABI is available.
      // Expected:
      //   const contract = new StarkContract(CairoOFTPeerABI, cairoOftAddr, starkAccount);
      //   await contract.invoke('set_peer', [adapterEid, { low: evmToFelt(adapterEvmAddr).toString(), high: '0' }]);
      return { status: 'error', message: 'Cairo wiring not yet implemented — contracts pending' };
    },
    [],
  );

  return {
    readTokenInfo,
    readEvmSideInfo,
    readAdapterState,
    readPeerState,
    readAllPeers,
    setEvmPeer,
    setEvmPeerToCairo,
    setEvmEnforcedOptions,
    setRateLimit,
    setDelegate,
    setCairoPeer,
  };
}
