import type { AnyChain, LZChain, StarknetChain } from '@/config/lzCatalog';
import type { PathwayVerifyResult, TxState, DVNProvider } from '@/types';
import type { useOFTWiring } from '@/hooks/useOFTWiring';
import type { useEndpointConfig } from '@/hooks/useEndpointConfig';
import type { useCairoEndpoint } from '@/hooks/useCairoEndpoint';
import type { useCairoOFT } from '@/hooks/useCairoOFT';
import type { useEvmWallet } from '@/hooks/useEvmWallet';
import type { useStarknetWallet } from '@/hooks/useStarknetWallet';

// ── Chain side abstraction ──────────────────────────────────────────────────

export interface ChainSide {
  kind: 'evm' | 'starknet';
  chain: AnyChain;
  contractAddr: string;
  isAdapter: boolean;
  isConnected: boolean;
  chainLabel: string;
  switchNetwork: () => void;
  needsNetworkSwitch: boolean;
  /** EVM-only fields */
  evmChain?: LZChain;
  /** Starknet-only fields */
  starkChain?: StarknetChain;
}

// ── Step definitions ────────────────────────────────────────────────────────

export type StepId = 'delegate' | 'libraries' | 'dvn' | 'options' | 'rateLimit' | 'peers';

export type SideStatus = 'unconfigured' | 'configured' | 'pending' | 'error';

export interface StepStatus {
  home: SideStatus;
  remote: SideStatus;
}

export interface StepDef {
  id: StepId;
  num: number;
  title: string;
  subtitle: string;
  visible: boolean;
}

export function buildStepDefs(isAdapter: boolean): StepDef[] {
  const steps: StepDef[] = [
    { id: 'delegate', num: 1, title: 'Delegate', subtitle: 'Authorize an account to configure the endpoint on behalf of this OFT.', visible: true },
    { id: 'libraries', num: 2, title: 'Message Libraries', subtitle: 'Assign send/receive libraries on EndpointV2.', visible: true },
    { id: 'dvn', num: 3, title: 'DVN & Security', subtitle: 'Configure DVN providers, block confirmations, and executor.', visible: true },
    { id: 'options', num: 4, title: 'Enforced Options', subtitle: 'Set minimum gas for lzReceive on both sides.', visible: true },
    { id: 'rateLimit', num: 5, title: 'Rate Limit', subtitle: 'Cap how much can be bridged per time window. Adapter only.', visible: isAdapter },
    { id: 'peers', num: isAdapter ? 6 : 5, title: 'Set Peers', subtitle: 'Register counterparty addresses. Opens the bridge — do this LAST.', visible: true },
  ];
  return steps;
}

// ── Hooks bundle passed to step components ──────────────────────────────────

export interface ConfigHooks {
  wiring: ReturnType<typeof useOFTWiring>;
  cairoEndpoint: ReturnType<typeof useCairoEndpoint>;
  cairo: ReturnType<typeof useCairoOFT>;
  evm: ReturnType<typeof useEvmWallet>;
  stark: ReturnType<typeof useStarknetWallet>;
}

// ── Shared step props ───────────────────────────────────────────────────────

export interface StepProps {
  home: ChainSide;
  remote: ChainSide;
  hooks: ConfigHooks;
  verifyResult: PathwayVerifyResult | null;
  onTxSuccess: () => void;
}
