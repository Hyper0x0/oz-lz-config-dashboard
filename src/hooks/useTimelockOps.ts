import { useCallback } from 'react';
import { Contract, JsonRpcSigner, JsonRpcProvider, BrowserProvider, ContractRunner, ZeroHash } from 'ethers';
import TimelockControllerABI from '@/abis/evm/TimelockController.json';
import type { TxState, OperationState, ITimelockController } from '@/types';
import { operationStateLabel } from '@/utils/timelock';
const ZERO_BYTES32 = ZeroHash;
const DEFAULT_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';

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
  checkRoles: (timelockAddr: string, account: string, walletProvider?: BrowserProvider) => Promise<{
    proposer: boolean; executor: boolean; canceller: boolean; admin: boolean;
  }>;
  grantRole: (timelockAddr: string, roleHash: string, account: string) => Promise<TxState>;
  revokeRole: (timelockAddr: string, roleHash: string, account: string) => Promise<TxState>;
  getRoleHashes: (timelockAddr: string, walletProvider?: BrowserProvider) => Promise<{
    proposer: string; executor: string; canceller: string; admin: string;
  }>;
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

  function readProvider(walletProvider?: BrowserProvider, rpcUrl?: string): ContractRunner {
    return walletProvider ?? new JsonRpcProvider(rpcUrl || DEFAULT_RPC);
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

  // ── Role management ──────────────────────────────────────────────────────

  const checkRoles = useCallback(
    async (timelockAddr: string, account: string, walletProvider?: BrowserProvider): Promise<{
      proposer: boolean; executor: boolean; canceller: boolean; admin: boolean;
    }> => {
      const c = timelockContract(timelockAddr, readProvider(walletProvider));
      const [proposerRole, executorRole, cancellerRole, adminRole] = await Promise.all([
        c.PROPOSER_ROLE(), c.EXECUTOR_ROLE(), c.CANCELLER_ROLE(), c.DEFAULT_ADMIN_ROLE(),
      ]);
      const [proposer, executor, canceller, admin] = await Promise.all([
        c.hasRole(proposerRole, account),
        c.hasRole(executorRole, account),
        c.hasRole(cancellerRole, account),
        c.hasRole(adminRole, account),
      ]);
      return { proposer, executor, canceller, admin };
    },
    [],
  );

  const grantRole = useCallback(
    async (timelockAddr: string, roleHash: string, account: string): Promise<TxState> => {
      if (!signer) return { status: 'error', message: 'Wallet not connected' };
      const c = timelockContract(timelockAddr, signer);
      try {
        const tx = await c.grantRole(roleHash, account);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
      }
    },
    [signer],
  );

  const revokeRole = useCallback(
    async (timelockAddr: string, roleHash: string, account: string): Promise<TxState> => {
      if (!signer) return { status: 'error', message: 'Wallet not connected' };
      const c = timelockContract(timelockAddr, signer);
      try {
        const tx = await c.revokeRole(roleHash, account);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: String(err instanceof Error ? err.message : err) };
      }
    },
    [signer],
  );

  const getRoleHashes = useCallback(
    async (timelockAddr: string, walletProvider?: BrowserProvider): Promise<{
      proposer: string; executor: string; canceller: string; admin: string;
    }> => {
      const c = timelockContract(timelockAddr, readProvider(walletProvider));
      const [proposer, executor, canceller, admin] = await Promise.all([
        c.PROPOSER_ROLE(), c.EXECUTOR_ROLE(), c.CANCELLER_ROLE(), c.DEFAULT_ADMIN_ROLE(),
      ]);
      return { proposer, executor, canceller, admin };
    },
    [],
  );

  return {
    schedule, execute, cancel, getMinDelay, getOperationState, getTimestamp,
    checkRoles, grantRole, revokeRole, getRoleHashes,
  };
}
