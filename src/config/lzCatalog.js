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
export function isStarknet(c) { return c.kind === 'starknet'; }
export function isEvm(c) { return c.kind === 'evm'; }
const MAINNET_ENDPOINT = '0x1a44076050125825900e736c501f859c50fe728c';
const TESTNET_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f';
export const LZ_CHAINS = [
    // ── Mainnet ────────────────────────────────────────────────────────────────
    { eid: 30101, chainId: 1, chainKey: 'ethereum', name: 'Ethereum', endpoint: MAINNET_ENDPOINT, rpc: 'https://ethereum.publicnode.com', isTestnet: false },
    { eid: 30102, chainId: 56, chainKey: 'bsc', name: 'BNB Chain', endpoint: MAINNET_ENDPOINT, rpc: 'https://bsc.publicnode.com', isTestnet: false },
    { eid: 30106, chainId: 43114, chainKey: 'avalanche', name: 'Avalanche', endpoint: MAINNET_ENDPOINT, rpc: 'https://avalanche-c-chain.publicnode.com', isTestnet: false },
    { eid: 30109, chainId: 137, chainKey: 'polygon', name: 'Polygon', endpoint: MAINNET_ENDPOINT, rpc: 'https://polygon.publicnode.com', isTestnet: false },
    { eid: 30110, chainId: 42161, chainKey: 'arbitrum', name: 'Arbitrum', endpoint: MAINNET_ENDPOINT, rpc: 'https://arbitrum-one.publicnode.com', isTestnet: false },
    { eid: 30111, chainId: 10, chainKey: 'optimism', name: 'Optimism', endpoint: MAINNET_ENDPOINT, rpc: 'https://optimism.publicnode.com', isTestnet: false },
    { eid: 30183, chainId: 59144, chainKey: 'linea', name: 'Linea', endpoint: MAINNET_ENDPOINT, rpc: 'https://linea.publicnode.com', isTestnet: false },
    { eid: 30184, chainId: 8453, chainKey: 'base', name: 'Base', endpoint: MAINNET_ENDPOINT, rpc: 'https://base.publicnode.com', isTestnet: false },
    { eid: 30165, chainId: 324, chainKey: 'zksync', name: 'zkSync', endpoint: MAINNET_ENDPOINT, rpc: 'https://mainnet.era.zksync.io', isTestnet: false },
    { eid: 30214, chainId: 534352, chainKey: 'scroll', name: 'Scroll', endpoint: MAINNET_ENDPOINT, rpc: 'https://rpc.scroll.io', isTestnet: false },
    { eid: 30181, chainId: 5000, chainKey: 'mantle', name: 'Mantle', endpoint: MAINNET_ENDPOINT, rpc: 'https://mantle.publicnode.com', isTestnet: false },
    { eid: 30243, chainId: 81457, chainKey: 'blast', name: 'Blast', endpoint: MAINNET_ENDPOINT, rpc: 'https://rpc.blast.io', isTestnet: false },
    // ── Testnet ────────────────────────────────────────────────────────────────
    { eid: 40161, chainId: 11155111, chainKey: 'sepolia', name: 'Ethereum Sepolia', endpoint: TESTNET_ENDPOINT, rpc: 'https://ethereum-sepolia.publicnode.com', isTestnet: true },
    { eid: 40231, chainId: 421614, chainKey: 'arbitrum-sepolia', name: 'Arbitrum Sepolia', endpoint: TESTNET_ENDPOINT, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', isTestnet: true },
    { eid: 40232, chainId: 11155420, chainKey: 'optimism-sepolia', name: 'Optimism Sepolia', endpoint: TESTNET_ENDPOINT, rpc: 'https://optimism-sepolia.publicnode.com', isTestnet: true },
    { eid: 40245, chainId: 84532, chainKey: 'base-sepolia', name: 'Base Sepolia', endpoint: TESTNET_ENDPOINT, rpc: 'https://sepolia.base.org', isTestnet: true },
];
export const LZ_CHAINS_BY_EID = Object.fromEntries(LZ_CHAINS.map((c) => [c.eid, c]));
export const LZ_CHAINS_BY_CHAIN_ID = Object.fromEntries(LZ_CHAINS.map((c) => [c.chainId, c]));
/** Returns testnet chains first if showTestnet is true. */
export function filteredChains(showTestnet) {
    return LZ_CHAINS.filter((c) => c.isTestnet === showTestnet);
}
