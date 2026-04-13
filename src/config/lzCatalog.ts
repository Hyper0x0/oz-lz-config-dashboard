/**
 * LayerZero V2 chain catalog.
 * Sources: https://docs.layerzero.network/v2/deployments/deployed-contracts
 *
 * Endpoint address:
 *   Mainnet (all EVM):  0x1a44076050125825900e736c501f859c50fe728c
 *   Testnet (all EVM):  0x6EDCE65403992e310A62460808c4b910D972f10f
 *
 * EID convention: 30xxx = mainnet, 40xxx = testnet
 */

/** Recommended defaults per chain, sourced from LayerZero docs & on-chain configs. */
export interface ChainDefaults {
  /** Block confirmations before DVN verification */
  confirmations: number;
  /** Recommended number of required DVNs (production ≥ 2) */
  requiredDVNs: number;
  /** Gas limit for lzReceive enforced options */
  gasLimit: number;
  /** Rate limit — max tokens (raw units) per window. 0 = no default. */
  rateLimitValue: string;
  /** Rate limit window in seconds */
  rateLimitWindow: number;
}

export interface LZChain {
  eid: number;
  chainId: number;
  name: string;
  /** Key used in the LayerZero metadata API (e.g. "arbitrum-sepolia") */
  chainKey: string;
  endpoint: string;
  /** Primary public RPC — operator should override with private RPC in .env.local */
  rpc: string;
  /** Fallback public RPC from chainlist.org — used automatically when primary fails */
  rpcFallback?: string;
  isTestnet: boolean;
  /** Populated when loaded from the LZ metadata API */
  executor?: string;
  sendLib?: string;
  receiveLib?: string;
  /** Recommended configuration defaults for this chain */
  defaults: ChainDefaults;
}

export interface StarknetChain {
  kind: 'starknet';
  eid: number;
  chainId: string;   // 'SN_SEPOLIA' | 'SN_MAIN'
  name: string;
  rpc: string;
  rpcFallback?: string;
  endpoint: string;
  isTestnet: boolean;
  /** Key used in the LayerZero DVN metadata API (e.g. "starknet-sepolia") */
  chainKey: string;
  /** SendUln302 address (same as receiveLib on Starknet) */
  sendLib?: string;
  /** ReceiveUln302 address (same as sendLib on Starknet) */
  receiveLib?: string;
  /** Default executor address */
  executor?: string;
  /** Recommended configuration defaults for this chain */
  defaults: ChainDefaults;
}

/** Discriminated union covering both EVM and Starknet chains. */
export type AnyChain =
  | (LZChain & { kind: 'evm' })
  | StarknetChain;

export function isStarknet(c: AnyChain): c is StarknetChain { return c.kind === 'starknet'; }
export function isEvm(c: AnyChain): c is LZChain & { kind: 'evm' } { return c.kind === 'evm'; }

const MAINNET_ENDPOINT = '0x1a44076050125825900e736c501f859c50fe728c';
const TESTNET_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f';

// ── Recommended defaults (sourced from LZ docs, simple-config examples, on-chain OApps) ──
const ETH_DEFAULTS: ChainDefaults    = { confirmations: 15, requiredDVNs: 2, gasLimit: 65000,  rateLimitValue: '0', rateLimitWindow: 3600 };
const L2_DEFAULTS: ChainDefaults     = { confirmations: 20, requiredDVNs: 2, gasLimit: 80000,  rateLimitValue: '0', rateLimitWindow: 3600 };
const TEST_DEFAULTS: ChainDefaults   = { confirmations: 1,  requiredDVNs: 1, gasLimit: 80000,  rateLimitValue: '0', rateLimitWindow: 60 };

export const LZ_CHAINS: LZChain[] = [
  // ── Mainnet ────────────────────────────────────────────────────────────────
  { eid: 30101, chainId: 1,        chainKey: 'ethereum',         name: 'Ethereum',          endpoint: MAINNET_ENDPOINT, rpc: 'https://ethereum.publicnode.com',              rpcFallback: 'https://eth.llamarpc.com',                    isTestnet: false, defaults: ETH_DEFAULTS },
  { eid: 30102, chainId: 56,       chainKey: 'bsc',              name: 'BNB Chain',         endpoint: MAINNET_ENDPOINT, rpc: 'https://bsc.publicnode.com',                   rpcFallback: 'https://bsc-dataseed.bnbchain.org',           isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30106, chainId: 43114,    chainKey: 'avalanche',        name: 'Avalanche',         endpoint: MAINNET_ENDPOINT, rpc: 'https://avalanche-c-chain.publicnode.com',     rpcFallback: 'https://api.avax.network/ext/bc/C/rpc',       isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30109, chainId: 137,      chainKey: 'polygon',          name: 'Polygon',           endpoint: MAINNET_ENDPOINT, rpc: 'https://polygon.publicnode.com',               rpcFallback: 'https://polygon-rpc.com',                     isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30110, chainId: 42161,    chainKey: 'arbitrum',         name: 'Arbitrum',          endpoint: MAINNET_ENDPOINT, rpc: 'https://arbitrum-one.publicnode.com',          rpcFallback: 'https://arb1.arbitrum.io/rpc',                isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30111, chainId: 10,       chainKey: 'optimism',         name: 'Optimism',          endpoint: MAINNET_ENDPOINT, rpc: 'https://optimism.publicnode.com',              rpcFallback: 'https://mainnet.optimism.io',                 isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30183, chainId: 59144,    chainKey: 'linea',            name: 'Linea',             endpoint: MAINNET_ENDPOINT, rpc: 'https://linea.publicnode.com',                 rpcFallback: 'https://rpc.linea.build',                     isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30184, chainId: 8453,     chainKey: 'base',             name: 'Base',              endpoint: MAINNET_ENDPOINT, rpc: 'https://base.publicnode.com',                  rpcFallback: 'https://mainnet.base.org',                    isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30165, chainId: 324,      chainKey: 'zksync',           name: 'zkSync',            endpoint: MAINNET_ENDPOINT, rpc: 'https://mainnet.era.zksync.io',                rpcFallback: 'https://1rpc.io/zksync2-era',                 isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30214, chainId: 534352,   chainKey: 'scroll',           name: 'Scroll',            endpoint: MAINNET_ENDPOINT, rpc: 'https://rpc.scroll.io',                        rpcFallback: 'https://1rpc.io/scroll',                      isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30181, chainId: 5000,     chainKey: 'mantle',           name: 'Mantle',            endpoint: MAINNET_ENDPOINT, rpc: 'https://mantle.publicnode.com',                rpcFallback: 'https://rpc.mantle.xyz',                      isTestnet: false, defaults: L2_DEFAULTS },
  { eid: 30243, chainId: 81457,    chainKey: 'blast',            name: 'Blast',             endpoint: MAINNET_ENDPOINT, rpc: 'https://rpc.blast.io',                         rpcFallback: 'https://1rpc.io/blast',                       isTestnet: false, defaults: L2_DEFAULTS },
  // ── Testnet ────────────────────────────────────────────────────────────────
  { eid: 40161, chainId: 11155111, chainKey: 'sepolia',          name: 'Ethereum Sepolia',  endpoint: TESTNET_ENDPOINT, rpc: 'https://ethereum-sepolia.publicnode.com',      rpcFallback: 'https://rpc.sepolia.org',                     isTestnet: true,  defaults: TEST_DEFAULTS },
  { eid: 40231, chainId: 421614,   chainKey: 'arbitrum-sepolia', name: 'Arbitrum Sepolia',  endpoint: TESTNET_ENDPOINT, rpc: 'https://arbitrum-sepolia.publicnode.com',      rpcFallback: 'https://arbitrum-sepolia.drpc.org',           isTestnet: true,  defaults: TEST_DEFAULTS },
  { eid: 40232, chainId: 11155420, chainKey: 'optimism-sepolia', name: 'Optimism Sepolia',  endpoint: TESTNET_ENDPOINT, rpc: 'https://optimism-sepolia.publicnode.com',      rpcFallback: 'https://sepolia.optimism.io',                 isTestnet: true,  defaults: TEST_DEFAULTS },
  { eid: 40245, chainId: 84532,    chainKey: 'base-sepolia',     name: 'Base Sepolia',      endpoint: TESTNET_ENDPOINT, rpc: 'https://sepolia.base.org',                     rpcFallback: 'https://base-sepolia.drpc.org',               isTestnet: true,  defaults: TEST_DEFAULTS },
];

export const LZ_CHAINS_BY_EID: Record<number, LZChain> = Object.fromEntries(
  LZ_CHAINS.map((c) => [c.eid, c]),
);

export const LZ_CHAINS_BY_CHAIN_ID: Record<number, LZChain> = Object.fromEntries(
  LZ_CHAINS.map((c) => [c.chainId, c]),
);

/** Returns testnet chains first if showTestnet is true. */
export function filteredChains(showTestnet: boolean): LZChain[] {
  return LZ_CHAINS.filter((c) => c.isTestnet === showTestnet);
}
