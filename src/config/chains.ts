import type { ChainConfig } from '@/types';
import type { ChainDefaults } from '@/config/lzCatalog';

export const ARB_SEPOLIA: ChainConfig = {
  id: 421614,
  eid: 40231,
  name: 'Arbitrum Sepolia',
  rpc: 'https://arbitrum-sepolia.publicnode.com',
};

export const BASE_SEPOLIA: ChainConfig = {
  id: 84532,
  eid: 40245,
  name: 'Base Sepolia',
  rpc: 'https://sepolia.base.org',
};

const STARKNET_DEFAULTS: ChainDefaults    = { confirmations: 15, requiredDVNs: 2, gasLimit: 200000, rateLimitValue: '0', rateLimitWindow: 3600 };
const STARKNET_TEST_DEFAULTS: ChainDefaults = { confirmations: 1,  requiredDVNs: 1, gasLimit: 200000, rateLimitValue: '0', rateLimitWindow: 60 };

/** Starknet Sepolia testnet — LayerZero V2 config */
export const STARKNET_TESTNET = {
  eid: 40500,
  chainId: 'SN_SEPOLIA',
  name: 'Starknet Sepolia',
  rpc: 'https://free-rpc.nethermind.io/sepolia-juno/v0_7',
  rpcFallback: 'https://api.cartridge.gg/x/starknet/sepolia',
  endpoint: '0x0316d70a6e0445a58c486215fac8ead48d3db985acde27efca9130da4c675878',
  chainKey: 'starknet-sepolia',
  // SendUln302 = ReceiveUln302 on Starknet (same contract)
  sendLib: '0x0706572d6f7b938c813a20dc1b0328b83de939066e25bd0fbe14c270077f769d',
  receiveLib: '0x0706572d6f7b938c813a20dc1b0328b83de939066e25bd0fbe14c270077f769d',
  executor: '0x068ffdaca6533001344f377beaf1137360168604b227df3e8cf735fe06da47a9',
  defaults: STARKNET_TEST_DEFAULTS,
};

/** Starknet Mainnet — LayerZero V2 config */
export const STARKNET_MAINNET = {
  eid: 30500,
  chainId: 'SN_MAIN',
  name: 'Starknet Mainnet',
  rpc: 'https://rpc.starknet.lava.build',
  rpcFallback: 'https://starknet.drpc.org',
  endpoint: '0x524e065abff21d225fb7b28f26ec2f48314ace6094bc085f0a7cf1dc2660f68',
  chainKey: 'starknet',
  // SendUln302 = ReceiveUln302 on Starknet (same contract)
  sendLib: '0x0727f40349719ac76861a51a0b3d3e07be1577fff137bb81a5dc32e5a5c61d38',
  receiveLib: '0x0727f40349719ac76861a51a0b3d3e07be1577fff137bb81a5dc32e5a5c61d38',
  executor: '0x03887bd8da2999d39e2e88fe55733c4cac8e20a6d51bfe162176c9f2eb134c65',
  defaults: STARKNET_DEFAULTS,
};

export const LZ_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f';

export const ARBISCAN_API_KEY = (import.meta.env['VITE_ARBISCAN_KEY'] as string) ?? '';

export const CONTRACTS = {
  adminGateway: '0x',
  adapter: '0x',
  peer: '0x',
};
