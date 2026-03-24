import type { ChainConfig } from '@/types';

export const ARB_SEPOLIA: ChainConfig = {
  id: 421614,
  eid: 40231,
  name: 'Arbitrum Sepolia',
  rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
};

export const BASE_SEPOLIA: ChainConfig = {
  id: 84532,
  eid: 40245,
  name: 'Base Sepolia',
  rpc: 'https://sepolia.base.org',
};

/** Starknet Sepolia testnet — LayerZero V2 config */
export const STARKNET_TESTNET = {
  eid: 40500,
  chainId: 'SN_SEPOLIA',
  name: 'Starknet Sepolia',
  rpc: 'https://starknet-sepolia.public.blastapi.io',
  endpoint: '0x0316d70a6e0445a58c486215fac8ead48d3db985acde27efca9130da4c675878',
  chainKey: 'starknet-sepolia',
  // SendUln302 = ReceiveUln302 on Starknet (same contract)
  sendLib: '0x0706572d6f7b938c813a20dc1b0328b83de939066e25bd0fbe14c270077f769d',
  receiveLib: '0x0706572d6f7b938c813a20dc1b0328b83de939066e25bd0fbe14c270077f769d',
};

/** Starknet Mainnet — LayerZero V2 config */
export const STARKNET_MAINNET = {
  eid: 30500,
  chainId: 'SN_MAIN',
  name: 'Starknet Mainnet',
  rpc: 'https://starknet-mainnet.public.blastapi.io',
  endpoint: '0x524e065abff21d225fb7b28f26ec2f48314ace6094bc085f0a7cf1dc2660f68',
  chainKey: 'starknet',
  // SendUln302 = ReceiveUln302 on Starknet (same contract)
  sendLib: '0x0727f40349719ac76861a51a0b3d3e07be1577fff137bb81a5dc32e5a5c61d38',
  receiveLib: '0x0727f40349719ac76861a51a0b3d3e07be1577fff137bb81a5dc32e5a5c61d38',
};

export const LZ_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f';

export const ARBISCAN_API_KEY = (import.meta.env['VITE_ARBISCAN_KEY'] as string) ?? '';

export const CONTRACTS = {
  adminGateway: '0x',
  adapter: '0x',
  peer: '0x',
};
