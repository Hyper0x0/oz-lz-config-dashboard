import { useCallback } from 'react';
import { Contract, JsonRpcSigner, JsonRpcProvider, BrowserProvider, ContractRunner, ZeroHash } from 'ethers';
import TimelockControllerABI from '@/abis/TimelockController.json';
import type { TxState, OperationState, ITimelockController } from '@/types';
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
  cancel: (timelockAddr: string, id: string) => Promise<TxState>;
  getMinDelay: (timelockAddr: string, walletProvider?: BrowserProvider) => Promise<bigint>;
  getOperationState: (timelockAddr: string, id: string, walletProvider?: BrowserProvider) => Promise<OperationState>;
  getTimestamp: (timelockAddr: string, id: string, walletProvider?: BrowserProvider) => Promise<bigint>;
}

function timelockContract(addr: string, runner: ContractRunner): ITimelockController {
  return new Contract(addr, TimelockControllerABI, runner) as unknown as ITimelockController;
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
      const contract = timelockContract(target, signer);
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
      const contract = timelockContract(target, signer);
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
      const contract = timelockContract(adminGatewayAddr, signer);
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

  function readProvider(walletProvider?: BrowserProvider): ContractRunner {
    return walletProvider ?? new JsonRpcProvider(ARB_SEPOLIA.rpc);
  }

  const getMinDelay = useCallback(
    async (timelockAddr: string, walletProvider?: BrowserProvider): Promise<bigint> => {
      return timelockContract(timelockAddr, readProvider(walletProvider)).getMinDelay();
    },
    [],
  );

  const getOperationState = useCallback(
    async (timelockAddr: string, id: string, walletProvider?: BrowserProvider): Promise<OperationState> => {
      const state = await timelockContract(timelockAddr, readProvider(walletProvider)).getOperationState(id);
      return operationStateLabel(state);
    },
    [],
  );

  const getTimestamp = useCallback(
    async (timelockAddr: string, id: string, walletProvider?: BrowserProvider): Promise<bigint> => {
      return timelockContract(timelockAddr, readProvider(walletProvider)).getTimestamp(id);
    },
    [],
  );

  return { schedule, execute, cancel, getMinDelay, getOperationState, getTimestamp };
}
