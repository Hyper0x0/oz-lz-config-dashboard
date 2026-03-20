import { useCallback } from 'react';
import { Contract, JsonRpcProvider, BrowserProvider, ContractRunner, AbiCoder, ZeroAddress } from 'ethers';
import EndpointV2ABI from '@/abis/EndpointV2.json';
import SyOFTAdapterABI from '@/abis/SyOFTAdapter.json';
import SySharePeerABI from '@/abis/SySharePeer.json';
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
}

export function useLZVerify() {
  const verify = useCallback(async (p: VerifyParams): Promise<PathwayVerifyResult> => {
    const homeProvider = p.walletProvider ?? new JsonRpcProvider(p.homeChain.rpc);
    const remoteProvider = new JsonRpcProvider(p.remoteChain.rpc);
    const homeEp = endpointContract(p.homeChain.endpoint, homeProvider);
    const remoteEp = endpointContract(p.remoteChain.endpoint, remoteProvider);
    const adapter = new Contract(p.adapterAddr, SyOFTAdapterABI, homeProvider) as unknown as IOFTAdapter;
    const peer = new Contract(p.peerAddr, SySharePeerABI, remoteProvider) as unknown as IOFTPeer;

    let error: string | null = null;
    const partial: Partial<Omit<PathwayVerifyResult, 'checks' | 'error'>> = {};

    try {
      // ── EID support check ──────────────────────────────────────────────────
      const [remoteEidSupported, homeEidSupported] = await Promise.all([
        homeEp.isSupportedEid(p.remoteChain.eid),
        remoteEp.isSupportedEid(p.homeChain.eid),
      ]);
      partial.remoteEidSupported = remoteEidSupported;
      partial.homeEidSupported = homeEidSupported;

      // ── Home side reads ────────────────────────────────────────────────────
      const [sendLib, delegate, homePeer, homeOpts] = await Promise.all([
        homeEp.getSendLibrary(p.adapterAddr, p.remoteChain.eid),
        homeEp.delegates(p.adapterAddr),
        adapter.peers(p.remoteChain.eid),
        adapter.enforcedOptions(p.remoteChain.eid, SEND_MSG_TYPE),
      ]);

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

      // Rate limit (adapter only — may not exist on peer)
      try {
        const rl = await adapter.rateLimits(p.remoteChain.eid);
        partial.homeRateLimit = { limit: rl[2], window: Number(rl[3]) };
      } catch {
        partial.homeRateLimit = null;
      }

      // ── Remote side reads ──────────────────────────────────────────────────
      const [recvLibResult, remotePeer, remoteOpts] = await Promise.all([
        remoteEp.getReceiveLibrary(p.peerAddr, p.homeChain.eid),
        peer.peers(p.homeChain.eid),
        peer.enforcedOptions(p.homeChain.eid, SEND_MSG_TYPE),
      ]);

      const [recvLib, recvLibIsDefault] = recvLibResult;
      partial.remoteReceiveLib = recvLib;
      partial.remoteReceiveLibIsDefault = recvLibIsDefault;
      partial.remotePeer = remotePeer;
      partial.remoteEnforcedOptions = remoteOpts;

      if (recvLib && recvLib !== ZeroAddress) {
        const dvnRaw = await remoteEp.getConfig(
          p.peerAddr,
          recvLib,
          p.homeChain.eid,
          CONFIG_TYPE_ULN,
        );
        partial.remoteDVN = decodeUln(dvnRaw);
      }
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    }

    const full = partial as Omit<PathwayVerifyResult, 'checks' | 'error'>;
    const checks = error ? [] : buildChecks(full);

    return { ...full, checks, error };
  }, []);

  return { verify };
}

