import { useState, useCallback } from 'react';
import { isStarknet, isEvm } from '@/config/lzCatalog';
import type { AnyChain, LZChain, StarknetChain } from '@/config/lzCatalog';
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

// ── Derive step statuses from verify result ─────────────────────────────────

function deriveStatuses(
  vr: PathwayVerifyResult | null,
  isAdapter: boolean,
  homeKind: 'evm' | 'starknet',
  remoteKind: 'evm' | 'starknet',
  txSuccessMap: Set<string>,
): Record<StepId, StepStatus> {
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
  const ZERO64 = '0x' + '0'.repeat(64);

  function checkLabel(label: string): boolean {
    return vr?.checks.find((c) => c.label === label)?.passed ?? false;
  }

  function fromTxOrVerify(stepId: string, side: 'home' | 'remote', verifyPassed: boolean): 'configured' | 'unconfigured' {
    if (txSuccessMap.has(`${stepId}-${side}`)) return 'configured';
    return verifyPassed ? 'configured' : 'unconfigured';
  }

  return {
    delegate: {
      home: fromTxOrVerify('delegate', 'home',
        vr ? (!!vr.homeDelegate && vr.homeDelegate !== ZERO_ADDR) : false),
      remote: fromTxOrVerify('delegate', 'remote',
        vr ? (!!vr.remoteDelegate && vr.remoteDelegate !== ZERO_ADDR) : false),
    },
    libraries: {
      home: fromTxOrVerify('libraries', 'home', checkLabel('Send library set')),
      remote: fromTxOrVerify('libraries', 'remote', checkLabel('Receive library set')),
    },
    dvn: {
      home: fromTxOrVerify('dvn', 'home',
        checkLabel('DVNs configured (send side)') && checkLabel('Executor configured')),
      remote: fromTxOrVerify('dvn', 'remote', checkLabel('DVNs configured (receive side)')),
    },
    options: {
      home: fromTxOrVerify('options', 'home', checkLabel('Enforced options set (send side)')),
      remote: fromTxOrVerify('options', 'remote', checkLabel('Enforced options set (receive side)')),
    },
    rateLimit: {
      home: fromTxOrVerify('rateLimit', 'home', !!vr?.homeRateLimit),
      remote: 'configured', // N/A for remote
    },
    peers: {
      home: fromTxOrVerify('peers', 'home', checkLabel('Peer set (home → remote)')),
      remote: fromTxOrVerify('peers', 'remote', checkLabel('Peer set (remote → home)')),
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

  const homeSide = buildSide(home, homeAddr, isAdapter, evm, stark);
  const remoteSide = buildSide(remote, remoteAddr, false, evm, stark);

  const hooks: ConfigHooks = { wiring, cairoEndpoint, cairo, evm, stark };
  const steps = buildStepDefs(isAdapter && homeSide.kind === 'evm');

  const statuses = deriveStatuses(verifyResult, isAdapter, homeSide.kind, remoteSide.kind, txSuccessMap);

  const handleTxSuccess = useCallback((stepId: StepId, side: 'home' | 'remote') => {
    setTxSuccessMap((prev) => { const next = new Set(prev); next.add(`${stepId}-${side}`); return next; });
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
