import { Interface } from 'ethers';
import AdminGatewayABI from '@/abis/AdminGateway.json';
import type { VaultState } from '@/types';

const iface = new Interface(AdminGatewayABI);

export const encodeRegisterVault = (
  vault: string,
  pool: string,
  share: string,
  oft: string,
): string => iface.encodeFunctionData('registerVault', [vault, pool, share, oft]);

export const encodeSetVaultState = (vaultId: bigint, state: VaultState): string =>
  iface.encodeFunctionData('setVaultState', [vaultId, state]);

export const encodeSetVaultOft = (vaultId: bigint, oft: string): string =>
  iface.encodeFunctionData('setVaultOft', [vaultId, oft]);

export const encodeSetPerformanceFeeBps = (vaultId: bigint, bps: bigint): string =>
  iface.encodeFunctionData('setPerformanceFeeBps', [vaultId, bps]);

export const encodeSetMaintenanceFeeBps = (vaultId: bigint, bps: bigint): string =>
  iface.encodeFunctionData('setMaintenanceFeeBps', [vaultId, bps]);

export const encodeSetFeeRecipient = (vaultId: bigint, recipient: string): string =>
  iface.encodeFunctionData('setFeeRecipient', [vaultId, recipient]);

export const encodeSetKeeper = (vaultId: bigint, keeper: string): string =>
  iface.encodeFunctionData('setKeeper', [vaultId, keeper]);

export const encodeSetAllocator = (vaultId: bigint, allocator: string): string =>
  iface.encodeFunctionData('setAllocator', [vaultId, allocator]);
