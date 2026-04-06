import { useState, useCallback, useEffect, useRef } from 'react';
import { isStarknet, isEvm } from '@/config/lzCatalog';
import type { AnyChain, LZChain, StarknetChain } from '@/config/lzCatalog';
// StarknetChain used in readCairoSide
import type { PathwayVerifyResult } from '@/types';
import type { useOFTWiring } from '@/hooks/useOFTWiring';
import type { useCairoEndpoint } from '@/hooks/useCairoEndpoint';
import type { useCairoOFT } from '@/hooks/useCairoOFT';
import type { useEvmWallet } from '@/hooks/useEvmWallet';
import type { useStarknetWallet } from '@/hooks/useStarknetWallet';

import { buildStepDefs, type ChainSide, type StepId, type StepStatus, type ConfigHooks } from './types';
import { StepCard } from './StepCard';
import { ProgressBar } from './ProgressBar';
import { StepDelegate } from './steps/StepDelegate';
import { StepLibraries } from './steps/StepLibraries';
import { StepDVN } from './steps/StepDVN';
import { StepOptions } from './steps/StepOptions';
import { StepRateLimit } from './steps/StepRateLimit';
import { StepPeers } from './steps/StepPeers';

// ── Props ───────────────────────────────────────────────────────────────────

interface ConfigureFlowProps {
  home: AnyChain;
  remote: AnyChain;
  homeAddr: string;
  remoteAddr: string;
  isAdapter: boolean;
  evm: ReturnType<typeof useEvmWallet>;
  stark: ReturnType<typeof useStarknetWallet>;
  wiring: ReturnType<typeof useOFTWiring>;
  cairoEndpoint: ReturnType<typeof useCairoEndpoint>;
  cairo: ReturnType<typeof useCairoOFT>;
  verifyResult: PathwayVerifyResult | null;
  onRefreshVerify: () => void;
}

// ── Build ChainSide adapter ─────────────────────────────────────────────────

function buildSide(
  chain: AnyChain,
  contractAddr: string,
  isAdapter: boolean,
  evm: ReturnType<typeof useEvmWallet>,
  stark: ReturnType<typeof useStarknetWallet>,
): ChainSide {
  if (isStarknet(chain)) {
    return {
      kind: 'starknet',
      chain,
      contractAddr,
      isAdapter: false, // Starknet side is never the adapter
      isConnected: stark.isConnected,
      chainLabel: chain.name,
      switchNetwork: () => {},
      needsNetworkSwitch: false,
      starkChain: chain,
    };
  }
  const evmChain = chain as LZChain & { kind: 'evm' };
  return {
    kind: 'evm',
    chain,
    contractAddr,
    isAdapter,
    isConnected: evm.isConnected,
    chainLabel: evmChain.name,
    switchNetwork: () => evm.switchNetwork(evmChain.chainId),
    needsNetworkSwitch: evm.isConnected && evm.chainId !== evmChain.chainId,
    evmChain,
  };
}

// ── Cairo on-chain state (for Starknet sides) ──────────────────────────────

interface CairoSideState {
  delegate: boolean;
  sendLib: boolean;
  recvLib: boolean;
  enforcedOptions: boolean;
  peer: boolean;
}

const EMPTY_CAIRO: CairoSideState = { delegate: false, sendLib: false, recvLib: false, enforcedOptions: false, peer: false };

// ── Derive step statuses from verify result + cairo reads ───────────────────

function deriveStatuses(
  vr: PathwayVerifyResult | null,
  isAdapter: boolean,
  homeKind: 'evm' | 'starknet',
  remoteKind: 'evm' | 'starknet',
  txSuccessMap: Set<string>,
  homeCairo: CairoSideState,
  remoteCairo: CairoSideState,
): Record<StepId, StepStatus> {
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

  function checkLabel(label: string): boolean {
    return vr?.checks.find((c) => c.label === label)?.passed ?? false;
  }

  function fromTxOrVerify(stepId: string, side: 'home' | 'remote', verifyPassed: boolean): 'configured' | 'unconfigured' {
    if (txSuccessMap.has(`${stepId}-${side}`)) return 'configured';
    return verifyPassed ? 'configured' : 'unconfigured';
  }

  // For each step+side: use EVM verify result when available, else Cairo reads
  function homeCheck(stepId: string, evmCheck: boolean, cairoCheck: boolean): 'configured' | 'unconfigured' {
    return fromTxOrVerify(stepId, 'home', homeKind === 'evm' ? evmCheck : cairoCheck);
  }

  function remoteCheck(stepId: string, evmCheck: boolean, cairoCheck: boolean): 'configured' | 'unconfigured' {
    return fromTxOrVerify(stepId, 'remote', remoteKind === 'evm' ? evmCheck : cairoCheck);
  }

  return {
    delegate: {
      home: homeCheck('delegate',
        vr ? (!!vr.homeDelegate && vr.homeDelegate !== ZERO_ADDR) : false,
        homeCairo.delegate),
      remote: remoteCheck('delegate',
        vr ? (!!vr.remoteDelegate && vr.remoteDelegate !== ZERO_ADDR) : false,
        remoteCairo.delegate),
    },
    libraries: {
      home: homeCheck('libraries', checkLabel('Send library set'), homeCairo.sendLib),
      remote: remoteCheck('libraries', checkLabel('Receive library set'), remoteCairo.recvLib),
    },
    dvn: {
      home: homeCheck('dvn',
        checkLabel('DVNs configured (send side)') && checkLabel('Executor configured'),
        false), // No DVN read method for Starknet yet — falls back to tx tracking
      remote: remoteCheck('dvn', checkLabel('DVNs configured (receive side)'), false),
    },
    options: {
      home: homeCheck('options', checkLabel('Enforced options set (send side)'), homeCairo.enforcedOptions),
      remote: remoteCheck('options', checkLabel('Enforced options set (receive side)'), remoteCairo.enforcedOptions),
    },
    rateLimit: {
      home: fromTxOrVerify('rateLimit', 'home', !!vr?.homeRateLimit),
      remote: 'configured',
    },
    peers: {
      home: homeCheck('peers', checkLabel('Peer set (home → remote)'), homeCairo.peer),
      remote: remoteCheck('peers', checkLabel('Peer set (remote → home)'), remoteCairo.peer),
    },
  };
}

// ── Step component map ──────────────────────────────────────────────────────

const STEP_COMPONENTS: Record<StepId, React.ComponentType<any>> = {
  delegate: StepDelegate,
  libraries: StepLibraries,
  dvn: StepDVN,
  options: StepOptions,
  rateLimit: StepRateLimit,
  peers: StepPeers,
};

// ── ConfigureFlow ───────────────────────────────────────────────────────────

export function ConfigureFlow({
  home, remote, homeAddr, remoteAddr, isAdapter,
  evm, stark, wiring, cairoEndpoint, cairo,
  verifyResult, onRefreshVerify,
}: ConfigureFlowProps): JSX.Element {

  const [openStep, setOpenStep] = useState<StepId | null>('delegate');
  const [txSuccessMap, setTxSuccessMap] = useState<Set<string>>(new Set());
  const [homeCairo, setHomeCairo] = useState<CairoSideState>(EMPTY_CAIRO);
  const [remoteCairo, setRemoteCairo] = useState<CairoSideState>(EMPTY_CAIRO);
  const [refreshTick, setRefreshTick] = useState(0);

  const homeSide = buildSide(home, homeAddr, isAdapter, evm, stark);
  const remoteSide = buildSide(remote, remoteAddr, false, evm, stark);

  const hooks: ConfigHooks = { wiring, cairoEndpoint, cairo, evm, stark };
  const steps = buildStepDefs(isAdapter && homeSide.kind === 'evm');

  // ── Read Starknet on-chain state for progress tracking ──────────────────
  const ZERO64 = '0x' + '0'.repeat(64);
  const cairoReadRef = useRef(0);

  // Capture stable references to avoid stale closures
  const cairoEndpointRef = useRef(cairoEndpoint);
  cairoEndpointRef.current = cairoEndpoint;
  const cairoRef = useRef(cairo);
  cairoRef.current = cairo;

  useEffect(() => {
    const tick = ++cairoReadRef.current;
    const ce = cairoEndpointRef.current;
    const co = cairoRef.current;

    async function readCairoSide(
      starkChain: StarknetChain | undefined,
      contractAddr: string,
      remoteEid: number,
      setter: (s: CairoSideState) => void,
    ): Promise<void> {
      if (!starkChain || !contractAddr || contractAddr === '0x') return;
      const rpc = starkChain.rpc;
      const ep = starkChain.endpoint;
      try {
        const [delegate, sendLib, recvLibResult, enforcedOpts, peerResult] = await Promise.allSettled([
          ce.readDelegate(ep, contractAddr, rpc),
          ce.readSendLibrary(ep, contractAddr, remoteEid, rpc),
          ce.readReceiveLibrary(ep, contractAddr, remoteEid, rpc),
          co.readEnforcedOptions(contractAddr, remoteEid, rpc),
          co.readPeer(contractAddr, remoteEid, rpc),
        ]);
        if (tick !== cairoReadRef.current) return; // stale
        setter({
          delegate: delegate.status === 'fulfilled' && !!delegate.value,
          sendLib: sendLib.status === 'fulfilled' && !!sendLib.value,
          recvLib: recvLibResult.status === 'fulfilled' && !!(recvLibResult.value as any)?.lib,
          enforcedOptions: enforcedOpts.status === 'fulfilled' && !!enforcedOpts.value,
          peer: peerResult.status === 'fulfilled' && !!(peerResult.value as any)?.peer && (peerResult.value as any).peer !== ZERO64,
        });
      } catch { /* ignore */ }
    }

    // Read home side if Starknet
    if (isStarknet(home)) {
      void readCairoSide(home as StarknetChain, homeAddr, remote.eid, setHomeCairo);
    }
    // Read remote side if Starknet
    if (isStarknet(remote)) {
      void readCairoSide(remote as StarknetChain, remoteAddr, home.eid, setRemoteCairo);
    }
  }, [homeAddr, remoteAddr, home.eid, remote.eid, refreshTick, home, remote]);

  const statuses = deriveStatuses(verifyResult, isAdapter, homeSide.kind, remoteSide.kind, txSuccessMap, homeCairo, remoteCairo);

  const handleTxSuccess = useCallback((stepId: StepId, side: 'home' | 'remote') => {
    setTxSuccessMap((prev) => { const next = new Set(prev); next.add(`${stepId}-${side}`); return next; });
    setRefreshTick((t) => t + 1);
    onRefreshVerify();
  }, [onRefreshVerify]);

  return (
    <div>
      <ProgressBar steps={steps} statuses={statuses} />

      {steps.filter((s) => s.visible).map((step) => {
        const StepComponent = STEP_COMPONENTS[step.id];
        return (
          <StepCard
            key={step.id}
            n={step.num}
            title={step.title}
            subtitle={step.subtitle}
            status={statuses[step.id]}
            open={openStep === step.id}
            onToggle={() => setOpenStep((prev) => prev === step.id ? null : step.id)}
          >
            <StepComponent
              home={homeSide}
              remote={remoteSide}
              hooks={hooks}
              verifyResult={verifyResult}
              onTxSuccess={() => handleTxSuccess(step.id, 'home')}
            />
          </StepCard>
        );
      })}
    </div>
  );
}
