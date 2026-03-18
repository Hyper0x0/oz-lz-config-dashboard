import type { ChainConfig } from '@/types';

export const ARB_SEPOLIA: ChainConfig = {
  id: 421614,
  eid: 40231,
  name: 'Arbitrum Sepolia',
  rpc: import.meta.env['VITE_HOME_RPC'] as string,
};

export const BASE_SEPOLIA: ChainConfig = {
  id: 84532,
  eid: 40245,
  name: 'Base Sepolia',
  rpc: import.meta.env['VITE_REMOTE_RPC'] as string,
};

/** Not a full ChainConfig — Starknet uses a different provider model. */
export const STARKNET_TESTNET = {
  // TODO: confirm the correct EID from LayerZero docs once Starknet deployment is ready
  eid: 0,
  name: 'Starknet Sepolia',
  rpc: import.meta.env['VITE_STARKNET_RPC'] as string,
};

export const LZ_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f';

export const CONTRACTS = {
  adminGateway: (import.meta.env['VITE_ADMIN_GATEWAY'] as string) ?? '',
  adapter: (import.meta.env['VITE_ADAPTER'] as string) ?? '',
  peer: (import.meta.env['VITE_PEER'] as string) ?? '',
  cairoOft: (import.meta.env['VITE_CAIRO_OFT'] as string) ?? '',
  adapterEid: Number(import.meta.env['VITE_ADAPTER_EID'] ?? 40231),
  peerEid: Number(import.meta.env['VITE_PEER_EID'] ?? 40245),
  cairoEid: Number(import.meta.env['VITE_CAIRO_EID'] ?? 0),
};
