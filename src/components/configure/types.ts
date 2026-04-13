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

// ── DVN prefill (read from chain) ───────────────────────────────────────────

export interface SideDvnPrefill {
  /** Required DVN addresses for the send-side ULN config (this side → other side). */
  sendDvns: string[];
  /** Required DVN addresses for the receive-side ULN config (other side → this side). */
  recvDvns: string[];
  /** Configured executor address (send side). */
  executor?: string;
  /** Send-side block confirmations. */
  confirmations?: number;
}

// ── Shared step props ───────────────────────────────────────────────────────

export interface StepProps {
  home: ChainSide;
  remote: ChainSide;
  hooks: ConfigHooks;
  verifyResult: PathwayVerifyResult | null;
  /** Pre-fill data read directly from each side's chain. */
  homePrefill?: SideDvnPrefill | null;
  remotePrefill?: SideDvnPrefill | null;
  onTxSuccess: (side?: 'home' | 'remote') => void;
}

// ── Explorer URL helper ─────────────────────────────────────────────────────

const EVM_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io/tx/', 42161: 'https://arbiscan.io/tx/',
  8453: 'https://basescan.org/tx/', 10: 'https://optimistic.etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/', 43114: 'https://snowtrace.io/tx/',
  56: 'https://bscscan.com/tx/', 421614: 'https://sepolia.arbiscan.io/tx/',
  84532: 'https://sepolia.basescan.org/tx/', 11155111: 'https://sepolia.etherscan.io/tx/',
  11155420: 'https://sepolia-optimism.etherscan.io/tx/',
  80002: 'https://amoy.polygonscan.com/tx/',
};

export function explorerTxUrl(side: ChainSide): string | undefined {
  if (side.kind === 'starknet') {
    return side.starkChain?.isTestnet
      ? 'https://sepolia.voyager.online/tx/'
      : 'https://voyager.online/tx/';
  }
  if (side.evmChain) return EVM_EXPLORERS[side.evmChain.chainId];
  return undefined;
}
