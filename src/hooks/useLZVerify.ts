import { useCallback } from 'react';
import { Contract, JsonRpcProvider, FetchRequest, BrowserProvider, ContractRunner, AbiCoder, ZeroAddress } from 'ethers';

/**
 * Create a JsonRpcProvider with:
 * - Batching disabled (avoids free-tier batch limits like DRPC's 3-request max)
 * - staticNetwork set to 'any' to skip auto-detection (avoids retry loops on slow RPCs)
 */
function unbatchedProvider(rpc: string): JsonRpcProvider {
  return new JsonRpcProvider(rpc, undefined, { batchMaxCount: 1, staticNetwork: true });
}
import EndpointV2ABI from '@/abis/evm/EndpointV2.json';
import OFTAdapterABI from '@/abis/evm/OFTAdapter.json';
import OFTABI from '@/abis/evm/OFT.json';
import type {
  PathwayVerifyResult,
  VerifyCheck,
  UlnConfig,
  ExecutorConfig,
  IOFTAdapter,
  IOFTPeer,
} from '@/types';
import type { LZChain } from '@/config/lzCatalog';

/** configType values on EndpointV2.getConfig */
const CONFIG_TYPE_EXECUTOR = 1;
const CONFIG_TYPE_ULN = 2;
const SEND_MSG_TYPE = 1;

const ULN_TUPLE =
  'tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs)';
const EXECUTOR_TUPLE = 'tuple(uint32 maxMessageSize, address executor)';

function decodeUln(raw: string): UlnConfig | null {
  try {
    const [decoded] = AbiCoder.defaultAbiCoder().decode([ULN_TUPLE], raw);
    return {
      confirmations: decoded.confirmations as bigint,
      requiredDVNCount: Number(decoded.requiredDVNCount),
      optionalDVNCount: Number(decoded.optionalDVNCount),
      optionalDVNThreshold: Number(decoded.optionalDVNThreshold),
      requiredDVNs: [...(decoded.requiredDVNs as string[])],
      optionalDVNs: [...(decoded.optionalDVNs as string[])],
    };
  } catch {
    return null;
  }
}

function decodeExecutor(raw: string): ExecutorConfig | null {
  try {
    const [decoded] = AbiCoder.defaultAbiCoder().decode([EXECUTOR_TUPLE], raw);
    return {
      maxMessageSize: Number(decoded.maxMessageSize),
      executor: decoded.executor as string,
    };
  } catch {
    return null;
  }
}

/** Race a promise against a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s — ${label}`)), ms)),
  ]);
}

/** Retry fn with fallback RPC when primary fails. Adds 15s timeout per attempt. */
async function withFallbackRpc<T>(
  primary: string,
  fallback: string | undefined,
  fn: (rpc: string) => Promise<T>,
): Promise<T> {
  try {
    return await withTimeout(fn(primary), 15_000, 'primary RPC');
  } catch (err) {
    if (fallback) return withTimeout(fn(fallback), 15_000, 'fallback RPC');
    throw err;
  }
}

/** Convert a raw ethers / network error into a readable one-liner. */
function formatVerifyError(err: unknown, chainHint?: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const hint = chainHint ? ` (${chainHint})` : '';
  if (msg.includes('CALL_EXCEPTION') || msg.includes('missing revert data')) {
    return `Endpoint contract call failed${hint} — the metadata API may have returned an incorrect endpoint address. Reads continue with partial data.`;
  }
  if (
    msg.includes('NETWORK_ERROR') ||
    msg.includes('failed to fetch') ||
    msg.toLowerCase().includes('timeout') ||
    msg.includes('ERR_NAME_NOT_RESOLVED')
  ) {
    return `RPC connection failed${hint} — the public endpoint is unavailable. Configure a private RPC in .env.local.`;
  }
  // Trim verbose ethers stack traces
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
}

function buildChecks(r: Omit<PathwayVerifyResult, 'checks' | 'error'>): VerifyCheck[] {
  const checks: VerifyCheck[] = [];

  // EID support
  checks.push({
    label: 'Remote EID supported (home endpoint)',
    passed: r.remoteEidSupported,
    detail: r.remoteEidSupported ? 'Remote chain is supported by this endpoint' : 'Remote EID not recognised — check the EID is correct',
    severity: 'critical',
  });
  checks.push({
    label: 'Home EID supported (remote endpoint)',
    passed: r.homeEidSupported,
    detail: r.homeEidSupported ? 'Home chain is supported by remote endpoint' : 'Home EID not recognised on remote endpoint',
    severity: 'critical',
  });

  // Send library
  checks.push({
    label: 'Send library set',
    passed: !!r.homeSendLib && r.homeSendLib !== ZeroAddress,
    detail: r.homeSendLib ?? 'Not set',
    severity: 'critical',
  });

  // Executor
  const execOk = !!r.homeExecutor && r.homeExecutor.executor !== ZeroAddress;
  checks.push({
    label: 'Executor configured',
    passed: execOk,
    detail: execOk
      ? `${r.homeExecutor!.executor} (max ${r.homeExecutor!.maxMessageSize} bytes)`
      : 'Executor address is zero — sends will fail',
    severity: 'critical',
  });

  // DVN send side
  const dvnSendOk = !!r.homeDVN && r.homeDVN.requiredDVNCount > 0;
  checks.push({
    label: 'DVNs configured (send side)',
    passed: dvnSendOk,
    detail: dvnSendOk
      ? `${r.homeDVN!.requiredDVNCount} required: ${r.homeDVN!.requiredDVNs.join(', ')}`
      : 'No required DVNs — messages cannot be verified',
    severity: 'critical',
  });

  // Production DVN count
  if (dvnSendOk && r.homeDVN!.requiredDVNCount < 2) {
    checks.push({
      label: 'DVN count ≥ 2 (mainnet recommendation)',
      passed: false,
      detail: `Only ${r.homeDVN!.requiredDVNCount} DVN configured. Use ≥ 2 for mainnet.`,
      severity: 'warning',
    });
  }

  // Block confirmations
  const confirmations = r.homeDVN?.confirmations ?? 0n;
  checks.push({
    label: 'Block confirmations set',
    passed: confirmations > 0n,
    detail: confirmations > 0n ? `${confirmations} blocks` : 'Using default (0)',
    severity: 'warning',
  });

  // Enforced options (home)
  const optsOk = !!r.homeEnforcedOptions && r.homeEnforcedOptions !== '0x';
  checks.push({
    label: 'Enforced options set (send side)',
    passed: optsOk,
    detail: optsOk ? r.homeEnforcedOptions! : 'Not set — callers must provide options or sends revert',
    severity: 'critical',
  });

  // Peer (home → remote)
  const homePeerOk = !!r.homePeer && r.homePeer !== ('0x' + '0'.repeat(64));
  checks.push({
    label: 'Peer set (home → remote)',
    passed: homePeerOk,
    detail: homePeerOk ? r.homePeer! : 'Not set — pathway not open',
    severity: 'critical',
  });

  // Delegate
  const delegateOk = !!r.homeDelegate && r.homeDelegate !== ZeroAddress;
  checks.push({
    label: 'Delegate set',
    passed: delegateOk,
    detail: delegateOk ? r.homeDelegate! : 'No delegate — only owner can configure endpoint',
    severity: 'warning',
  });

  // Receive library
  const recvLibOk = !!r.remoteReceiveLib && r.remoteReceiveLib !== ZeroAddress;
  checks.push({
    label: 'Receive library set',
    passed: recvLibOk && !r.remoteReceiveLibIsDefault,
    detail: recvLibOk
      ? `${r.remoteReceiveLib}${r.remoteReceiveLibIsDefault ? ' (default — set explicitly)' : ''}`
      : 'Not set',
    severity: r.remoteReceiveLibIsDefault ? 'warning' : 'critical',
  });

  // DVN receive side
  const dvnRecvOk = !!r.remoteDVN && r.remoteDVN.requiredDVNCount > 0;
  checks.push({
    label: 'DVNs configured (receive side)',
    passed: dvnRecvOk,
    detail: dvnRecvOk
      ? `${r.remoteDVN!.requiredDVNCount} required: ${r.remoteDVN!.requiredDVNs.join(', ')}`
      : 'No required DVNs on destination',
    severity: 'critical',
  });

  // DVN count symmetry — addresses differ per chain by design (each provider deploys separately),
  // so we only check that the same NUMBER of required DVNs is configured on both sides.
  if (dvnSendOk && dvnRecvOk) {
    const sendCount = r.homeDVN!.requiredDVNCount;
    const recvCount = r.remoteDVN!.requiredDVNCount;
    const countsMatch = sendCount === recvCount;
    checks.push({
      label: 'DVN count matches (send ↔ receive)',
      passed: countsMatch,
      detail: countsMatch
        ? `Both sides have ${sendCount} required DVN(s). Verify the same providers are configured on each chain.`
        : `Send side: ${sendCount} DVN(s) — Receive side: ${recvCount} DVN(s). Counts should match.`,
      severity: countsMatch ? 'info' : 'warning',
    });
  }

  // Enforced options (remote)
  const remoteOptsOk = !!r.remoteEnforcedOptions && r.remoteEnforcedOptions !== '0x';
  checks.push({
    label: 'Enforced options set (receive side)',
    passed: remoteOptsOk,
    detail: remoteOptsOk ? r.remoteEnforcedOptions! : 'Not set',
    severity: 'warning',
  });

  // Peer (remote → home)
  const remotePeerOk = !!r.remotePeer && r.remotePeer !== ('0x' + '0'.repeat(64));
  checks.push({
    label: 'Peer set (remote → home)',
    passed: remotePeerOk,
    detail: remotePeerOk ? r.remotePeer! : 'Not set — return pathway not open',
    severity: 'critical',
  });

  // ── B→A direction checks ─────────────────────────────────────────────────

  // B→A send library (remote sends back to home)
  const remoteSendLibOk = !!r.remoteSendLib && r.remoteSendLib !== ZeroAddress;
  checks.push({
    label: 'Send library set (B→A)',
    passed: remoteSendLibOk,
    detail: r.remoteSendLib ?? 'Not set on remote',
    severity: 'critical',
  });

  // B→A executor
  const remoteExecOk = !!r.remoteExecutor && r.remoteExecutor.executor !== ZeroAddress;
  checks.push({
    label: 'Executor configured (B→A)',
    passed: remoteExecOk,
    detail: remoteExecOk
      ? `${r.remoteExecutor!.executor} (max ${r.remoteExecutor!.maxMessageSize} bytes)`
      : 'Executor not set on remote — return sends will fail',
    severity: 'critical',
  });

  // B→A send DVN
  const remoteSendDvnOk = !!r.remoteSendDVN && r.remoteSendDVN.requiredDVNCount > 0;
  checks.push({
    label: 'DVNs configured (B→A send)',
    passed: remoteSendDvnOk,
    detail: remoteSendDvnOk
      ? `${r.remoteSendDVN!.requiredDVNCount} required: ${r.remoteSendDVN!.requiredDVNs.join(', ')}`
      : 'No required DVNs on remote send side',
    severity: 'critical',
  });

  // B→A receive library (home receives from remote)
  const homeRecvLibOk = !!r.homeReceiveLib && r.homeReceiveLib !== ZeroAddress;
  checks.push({
    label: 'Receive library set (B→A)',
    passed: homeRecvLibOk && !r.homeReceiveLibIsDefault,
    detail: homeRecvLibOk
      ? `${r.homeReceiveLib}${r.homeReceiveLibIsDefault ? ' (default — set explicitly)' : ''}`
      : 'Not set on home',
    severity: r.homeReceiveLibIsDefault ? 'warning' : 'critical',
  });

  // B→A receive DVN
  const homeRecvDvnOk = !!r.homeReceiveDVN && r.homeReceiveDVN.requiredDVNCount > 0;
  checks.push({
    label: 'DVNs configured (B→A receive)',
    passed: homeRecvDvnOk,
    detail: homeRecvDvnOk
      ? `${r.homeReceiveDVN!.requiredDVNCount} required: ${r.homeReceiveDVN!.requiredDVNs.join(', ')}`
      : 'No required DVNs on home receive side',
    severity: 'critical',
  });

  // B→A delegate
  const remoteDelegateOk = !!r.remoteDelegate && r.remoteDelegate !== ZeroAddress;
  checks.push({
    label: 'Delegate set (B→A)',
    passed: remoteDelegateOk,
    detail: remoteDelegateOk ? r.remoteDelegate! : 'No delegate on remote',
    severity: 'warning',
  });

  // B→A DVN count symmetry (send-side B→A vs receive-side B→A)
  if (remoteSendDvnOk && homeRecvDvnOk) {
    const baSendCount = r.remoteSendDVN!.requiredDVNCount;
    const baRecvCount = r.homeReceiveDVN!.requiredDVNCount;
    const baMatch = baSendCount === baRecvCount;
    checks.push({
      label: 'DVN count matches (B→A send ↔ receive)',
      passed: baMatch,
      detail: baMatch
        ? `Both B→A sides have ${baSendCount} required DVN(s).`
        : `B→A send: ${baSendCount} — B→A receive: ${baRecvCount}. Counts should match.`,
      severity: baMatch ? 'info' : 'warning',
    });
  }

  // Production: DVN count ≥ 2 on remote send side
  if (remoteSendDvnOk && r.remoteSendDVN!.requiredDVNCount < 2) {
    checks.push({
      label: 'DVN count ≥ 2 B→A (mainnet recommendation)',
      passed: false,
      detail: `Only ${r.remoteSendDVN!.requiredDVNCount} DVN on remote send side. Use ≥ 2 for mainnet.`,
      severity: 'warning',
    });
  }

  // Reliance on default libraries warning
  if (r.remoteReceiveLibIsDefault) {
    checks.push({
      label: 'Receive library using defaults (A→B)',
      passed: false,
      detail: 'Receive library falls back to default. Set explicitly for production — defaults may change or be misconfigured.',
      severity: 'warning',
    });
  }
  if (r.homeReceiveLibIsDefault) {
    checks.push({
      label: 'Receive library using defaults (B→A)',
      passed: false,
      detail: 'Home receive library falls back to default. Set explicitly for production.',
      severity: 'warning',
    });
  }

  return checks;
}

interface EndpointRead {
  getSendLibrary: (sender: string, eid: number) => Promise<string>;
  getReceiveLibrary: (receiver: string, srcEid: number) => Promise<[string, boolean]>;
  getConfig: (oapp: string, lib: string, eid: number, configType: number) => Promise<string>;
  delegates: (oapp: string) => Promise<string>;
  isSupportedEid: (eid: number) => Promise<boolean>;
}

function endpointContract(addr: string, provider: ContractRunner): EndpointRead {
  return new Contract(addr, EndpointV2ABI, provider) as unknown as EndpointRead;
}

export interface VerifyParams {
  adapterAddr: string;
  peerAddr: string;
  homeChain: LZChain;
  remoteChain: LZChain;
  /** When provided, used instead of homeChain.rpc for home-side reads */
  walletProvider?: BrowserProvider;
  /** When provided, used instead of remoteChain.rpc for remote-side reads */
  remoteWalletProvider?: BrowserProvider;
}

export function useLZVerify() {
  const verify = useCallback(async (p: VerifyParams): Promise<PathwayVerifyResult> => {
    let error: string | null = null;
    const partial: Partial<Omit<PathwayVerifyResult, 'checks' | 'error'>> = {};

    // ── EID support check — each chain independently ────────────────────────
    try {
      await withFallbackRpc(p.homeChain.rpc, p.homeChain.rpcFallback, async (rpc) => {
        const provider = p.walletProvider ?? unbatchedProvider(rpc);
        const homeEp = endpointContract(p.homeChain.endpoint, provider);
        partial.remoteEidSupported = await homeEp.isSupportedEid(p.remoteChain.eid);
      });
    } catch (err) {
      partial.remoteEidSupported = false;
      if (!error) error = formatVerifyError(err, p.homeChain.name);
    }

    try {
      await withFallbackRpc(p.remoteChain.rpc, p.remoteChain.rpcFallback, async (rpc) => {
        const provider = p.remoteWalletProvider ?? unbatchedProvider(rpc);
        const remoteEp = endpointContract(p.remoteChain.endpoint, provider);
        partial.homeEidSupported = await remoteEp.isSupportedEid(p.homeChain.eid);
      });
    } catch (err) {
      partial.homeEidSupported = false;
      if (!error) error = formatVerifyError(err, p.remoteChain.name);
    }

    // ── Home side reads (A→B send + B→A receive) ─────────────────────────
    try {
      await withFallbackRpc(p.homeChain.rpc, p.homeChain.rpcFallback, async (rpc) => {
        const provider = p.walletProvider ?? unbatchedProvider(rpc);
        const homeEp = endpointContract(p.homeChain.endpoint, provider);
        const adapter = new Contract(p.adapterAddr, OFTAdapterABI, provider) as unknown as IOFTAdapter;

        const [sendLib, delegate, homePeer, homeOpts, recvLibResult] = await Promise.all([
          homeEp.getSendLibrary(p.adapterAddr, p.remoteChain.eid),
          homeEp.delegates(p.adapterAddr),
          adapter.peers(p.remoteChain.eid),
          adapter.enforcedOptions(p.remoteChain.eid, SEND_MSG_TYPE),
          homeEp.getReceiveLibrary(p.adapterAddr, p.remoteChain.eid),
        ]);

        // A→B send side
        partial.homeSendLib = sendLib;
        partial.homeDelegate = delegate;
        partial.homePeer = homePeer;
        partial.homeEnforcedOptions = homeOpts;

        if (sendLib && sendLib !== ZeroAddress) {
          const [execRaw, ulnRaw] = await Promise.all([
            homeEp.getConfig(p.adapterAddr, sendLib, p.remoteChain.eid, CONFIG_TYPE_EXECUTOR),
            homeEp.getConfig(p.adapterAddr, sendLib, p.remoteChain.eid, CONFIG_TYPE_ULN),
          ]);
          partial.homeExecutor = decodeExecutor(execRaw);
          partial.homeDVN = decodeUln(ulnRaw);
        }

        // B→A receive side (home receives from remote)
        const [homeRecvLib, homeRecvLibIsDefault] = recvLibResult;
        partial.homeReceiveLib = homeRecvLib;
        partial.homeReceiveLibIsDefault = homeRecvLibIsDefault;
        if (homeRecvLib && homeRecvLib !== ZeroAddress) {
          const dvnRaw = await homeEp.getConfig(p.adapterAddr, homeRecvLib, p.remoteChain.eid, CONFIG_TYPE_ULN);
          partial.homeReceiveDVN = decodeUln(dvnRaw);
        }

        try {
          const rl = await adapter.rateLimits(p.remoteChain.eid);
          partial.homeRateLimit = { limit: rl[2], window: Number(rl[3]) };
        } catch {
          partial.homeRateLimit = null;
        }
      });
    } catch (err) {
      if (!error) error = formatVerifyError(err, p.homeChain.name);
    }

    // ── Remote side reads (A→B receive + B→A send) ──────────────────────
    try {
      await withFallbackRpc(p.remoteChain.rpc, p.remoteChain.rpcFallback, async (rpc) => {
        const provider = p.remoteWalletProvider ?? unbatchedProvider(rpc);
        const remoteEp = endpointContract(p.remoteChain.endpoint, provider);
        const peer = new Contract(p.peerAddr, OFTABI, provider) as unknown as IOFTPeer;

        const [recvLibResult, remotePeer, remoteOpts, remoteSendLib, remoteDelegate] = await Promise.all([
          remoteEp.getReceiveLibrary(p.peerAddr, p.homeChain.eid),
          peer.peers(p.homeChain.eid),
          peer.enforcedOptions(p.homeChain.eid, SEND_MSG_TYPE),
          remoteEp.getSendLibrary(p.peerAddr, p.homeChain.eid),
          remoteEp.delegates(p.peerAddr),
        ]);

        // A→B receive side
        const [recvLib, recvLibIsDefault] = recvLibResult;
        partial.remoteReceiveLib = recvLib;
        partial.remoteReceiveLibIsDefault = recvLibIsDefault;
        partial.remotePeer = remotePeer;
        partial.remoteEnforcedOptions = remoteOpts;

        if (recvLib && recvLib !== ZeroAddress) {
          const dvnRaw = await remoteEp.getConfig(p.peerAddr, recvLib, p.homeChain.eid, CONFIG_TYPE_ULN);
          partial.remoteDVN = decodeUln(dvnRaw);
        }

        // B→A send side
        partial.remoteSendLib = remoteSendLib;
        partial.remoteDelegate = remoteDelegate;
        if (remoteSendLib && remoteSendLib !== ZeroAddress) {
          const [execRaw, ulnRaw] = await Promise.all([
            remoteEp.getConfig(p.peerAddr, remoteSendLib, p.homeChain.eid, CONFIG_TYPE_EXECUTOR),
            remoteEp.getConfig(p.peerAddr, remoteSendLib, p.homeChain.eid, CONFIG_TYPE_ULN),
          ]);
          partial.remoteExecutor = decodeExecutor(execRaw);
          partial.remoteSendDVN = decodeUln(ulnRaw);
        }
      });
    } catch (err) {
      if (!error) error = formatVerifyError(err, p.remoteChain.name);
    }

    const full = partial as Omit<PathwayVerifyResult, 'checks' | 'error'>;
    const checks = buildChecks(full);

    return { ...full, checks, error };
  }, []);

  /**
   * Read the EVM side of a mixed EVM↔Starknet pathway.
   * Returns structured state for use in StarknetVerifyPanel.
   */
  const readEvmSideForStarknet = useCallback(async (
    evmOftAddr: string,
    remoteEid: number,
    chain: LZChain,
    walletProvider?: BrowserProvider,
  ): Promise<{
    sendLib: string | null;
    recvLib: string | null;
    recvLibIsDefault: boolean;
    delegate: string | null;
    executor: ExecutorConfig | null;
    dvnSend: UlnConfig | null;
    dvnRecv: UlnConfig | null;
    enforcedOptions: string | null;
    peer: string | null;
  }> => {
    const nullResult = {
      sendLib: null, recvLib: null, recvLibIsDefault: false,
      delegate: null, executor: null, dvnSend: null, dvnRecv: null,
      enforcedOptions: null, peer: null,
    };
    try {
      const provider = walletProvider ?? new JsonRpcProvider(chain.rpc);
      const ep = endpointContract(chain.endpoint, provider);
      const oft = new Contract(evmOftAddr, OFTABI, provider) as unknown as IOFTPeer;

      const [sendLib, delegate, peer, enforcedOptions] = await Promise.all([
        ep.getSendLibrary(evmOftAddr, remoteEid),
        ep.delegates(evmOftAddr),
        oft.peers(remoteEid),
        oft.enforcedOptions(remoteEid, SEND_MSG_TYPE),
      ]);

      const [recvLibRaw] = await Promise.all([ep.getReceiveLibrary(evmOftAddr, remoteEid)]);
      const [recvLib, recvLibIsDefault] = recvLibRaw;

      let executor: ExecutorConfig | null = null;
      let dvnSend: UlnConfig | null = null;
      if (sendLib && sendLib !== ZeroAddress) {
        const [execRaw, ulnRaw] = await Promise.all([
          ep.getConfig(evmOftAddr, sendLib, remoteEid, CONFIG_TYPE_EXECUTOR),
          ep.getConfig(evmOftAddr, sendLib, remoteEid, CONFIG_TYPE_ULN),
        ]);
        executor = decodeExecutor(execRaw);
        dvnSend = decodeUln(ulnRaw);
      }

      let dvnRecv: UlnConfig | null = null;
      if (recvLib && recvLib !== ZeroAddress) {
        const dvnRaw = await ep.getConfig(evmOftAddr, recvLib, remoteEid, CONFIG_TYPE_ULN);
        dvnRecv = decodeUln(dvnRaw);
      }

      return {
        sendLib: sendLib ?? null,
        recvLib: recvLib ?? null,
        recvLibIsDefault,
        delegate: delegate ?? null,
        executor,
        dvnSend,
        dvnRecv,
        enforcedOptions: enforcedOptions ?? null,
        peer: peer ?? null,
      };
    } catch {
      return nullResult;
    }
  }, []);

  return { verify, readEvmSideForStarknet };
}

