import { useCallback } from 'react';
import { Contract, JsonRpcSigner, JsonRpcProvider, ZeroHash } from 'ethers';
import AdminGatewayABI from '@/abis/AdminGateway.json';
import type { TxState, OperationState, IAdminGateway } from '@/types';
import { operationStateLabel } from '@/utils/timelock';
import { ARB_SEPOLIA } from '@/config/chains';

const ZERO_BYTES32 = ZeroHash;

interface TimelockOps {
  schedule: (
    target: string,
    value: bigint,
    data: string,
    predecessor: string,
    salt: string,
    delay: bigint,
  ) => Promise<TxState>;
  execute: (
    target: string,
    value: bigint,
    data: string,
    predecessor: string,
    salt: string,
  ) => Promise<TxState>;
  cancel: (adminGatewayAddr: string, id: string) => Promise<TxState>;
  getMinDelay: (adminGatewayAddr: string) => Promise<bigint>;
  getOperationState: (adminGatewayAddr: string, id: string) => Promise<OperationState>;
  getTimestamp: (adminGatewayAddr: string, id: string) => Promise<bigint>;
}

function gatewayContract(addr: string, signerOrProvider: JsonRpcSigner | JsonRpcProvider): IAdminGateway {
  return new Contract(addr, AdminGatewayABI, signerOrProvider) as unknown as IAdminGateway;
}

export function useTimelockOps(signer: JsonRpcSigner | null): TimelockOps {
  const schedule = useCallback(
    async (
      target: string,
      value: bigint,
      data: string,
      predecessor: string,
      salt: string,
      delay: bigint,
    ): Promise<TxState> => {
      if (!signer) return { status: 'error', message: 'Wallet not connected' };
      const contract = gatewayContract(target, signer);
      try {
        const tx = await contract.schedule(target, value, data, predecessor || ZERO_BYTES32, salt, delay);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
      }
    },
    [signer],
  );

  const execute = useCallback(
    async (
      target: string,
      value: bigint,
      data: string,
      predecessor: string,
      salt: string,
    ): Promise<TxState> => {
      if (!signer) return { status: 'error', message: 'Wallet not connected' };
      const contract = gatewayContract(target, signer);
      try {
        const tx = await contract.execute(target, value, data, predecessor || ZERO_BYTES32, salt);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
      }
    },
    [signer],
  );

  const cancel = useCallback(
    async (adminGatewayAddr: string, id: string): Promise<TxState> => {
      if (!signer) return { status: 'error', message: 'Wallet not connected' };
      const contract = gatewayContract(adminGatewayAddr, signer);
      try {
        const tx = await contract.cancel(id);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
      }
    },
    [signer],
  );

  const getMinDelay = useCallback(
    async (adminGatewayAddr: string): Promise<bigint> => {
      const provider = new JsonRpcProvider(ARB_SEPOLIA.rpc);
      return gatewayContract(adminGatewayAddr, provider).getMinDelay();
    },
    [],
  );

  const getOperationState = useCallback(
    async (adminGatewayAddr: string, id: string): Promise<OperationState> => {
      const provider = new JsonRpcProvider(ARB_SEPOLIA.rpc);
      const state = await gatewayContract(adminGatewayAddr, provider).getOperationState(id);
      return operationStateLabel(state);
    },
    [],
  );

  const getTimestamp = useCallback(
    async (adminGatewayAddr: string, id: string): Promise<bigint> => {
      const provider = new JsonRpcProvider(ARB_SEPOLIA.rpc);
      return gatewayContract(adminGatewayAddr, provider).getTimestamp(id);
    },
    [],
  );

  return { schedule, execute, cancel, getMinDelay, getOperationState, getTimestamp };
}
