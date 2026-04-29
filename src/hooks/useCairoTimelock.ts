import { useCallback } from 'react';
import { RpcProvider, CallData, hash } from 'starknet';
import type { WalletAccount, Abi } from 'starknet';
import type { TxState, OperationState } from '@/types';
import { decodeContractError, extractErrorDetails } from '@/utils/decodeError';
import TimelockABI from '@/abis/svm/TimelockController.json';

const TIMELOCK_CALLDATA = new CallData(TimelockABI as Abi);

/** Starknet sn_keccak: keccak256 masked to 250 bits. */
function snKeccakRole(name: string): string {
  if (name === 'DEFAULT_ADMIN_ROLE') return '0x0';
  return hash.getSelectorFromName(name);
}

const ROLE_SELECTORS = {
  proposer: snKeccakRole('PROPOSER_ROLE'),
  executor: snKeccakRole('EXECUTOR_ROLE'),
  canceller: snKeccakRole('CANCELLER_ROLE'),
  admin: '0x0',
};

function stateFromNum(n: number): OperationState {
  const map: Record<number, OperationState> = { 0: 'Unset', 1: 'Waiting', 2: 'Ready', 3: 'Done' };
  return map[n] ?? 'Unset';
}

export interface CairoTimelockOps {
  getMinDelay: (addr: string, rpc: string) => Promise<bigint>;
  getOperationState: (addr: string, id: string, rpc: string) => Promise<OperationState>;
  getTimestamp: (addr: string, id: string, rpc: string) => Promise<bigint>;
  hashOperation: (addr: string, target: string, selector: string, calldata: string[], predecessor: string, salt: string, rpc: string) => Promise<string>;
  checkRoles: (addr: string, account: string, rpc: string) => Promise<{
    proposer: boolean; executor: boolean; canceller: boolean; admin: boolean;
  }>;
  schedule: (addr: string, target: string, selector: string, calldata: string[], predecessor: string, salt: string, delay: number) => Promise<TxState>;
  execute: (addr: string, target: string, selector: string, calldata: string[], predecessor: string, salt: string) => Promise<TxState>;
  cancel: (addr: string, id: string) => Promise<TxState>;
  grantRole: (addr: string, role: string, account: string) => Promise<TxState>;
  revokeRole: (addr: string, role: string, account: string) => Promise<TxState>;
  roleSelectors: typeof ROLE_SELECTORS;
}

function compileCallArgs(target: string, selector: string, calldata: string[], predecessor: string, salt: string, delay?: number): string[] {
  const payload = {
    call: { to: target, selector, calldata },
    predecessor: predecessor || '0x0',
    salt,
    ...(delay !== undefined ? { delay } : {}),
  };
  return TIMELOCK_CALLDATA.compile(delay !== undefined ? 'schedule' : 'execute', payload);
}

export function useCairoTimelock(account: WalletAccount | null): CairoTimelockOps {

  const getMinDelay = useCallback(async (addr: string, rpc: string): Promise<bigint> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const result = await provider.callContract({
      contractAddress: addr,
      entrypoint: 'get_min_delay',
      calldata: [],
    }, 'latest');
    return BigInt(result[0]);
  }, []);

  const getOperationState = useCallback(async (addr: string, id: string, rpc: string): Promise<OperationState> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const result = await provider.callContract({
      contractAddress: addr,
      entrypoint: 'get_operation_state',
      calldata: CallData.compile([id]),
    }, 'latest');
    return stateFromNum(Number(result[0]));
  }, []);

  const getTimestamp = useCallback(async (addr: string, id: string, rpc: string): Promise<bigint> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const result = await provider.callContract({
      contractAddress: addr,
      entrypoint: 'get_timestamp',
      calldata: CallData.compile([id]),
    }, 'latest');
    return BigInt(result[0]);
  }, []);

  const hashOperation = useCallback(async (
    addr: string, target: string, selector: string, calldata: string[],
    predecessor: string, salt: string, rpc: string,
  ): Promise<string> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const args = TIMELOCK_CALLDATA.compile('hash_operation', {
      call: { to: target, selector, calldata },
      predecessor: predecessor || '0x0',
      salt,
    });
    const result = await provider.callContract({
      contractAddress: addr,
      entrypoint: 'hash_operation',
      calldata: args,
    }, 'latest');
    return result[0];
  }, []);

  const checkRoles = useCallback(async (addr: string, walletAddr: string, rpc: string) => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const check = async (role: string): Promise<boolean> => {
      try {
        const r = await provider.callContract({
          contractAddress: addr,
          entrypoint: 'has_role',
          calldata: CallData.compile([role, walletAddr]),
        }, 'latest');
        return BigInt(r[0]) !== 0n;
      } catch {
        return false;
      }
    };
    const [proposer, executor, canceller, admin] = await Promise.all([
      check(ROLE_SELECTORS.proposer),
      check(ROLE_SELECTORS.executor),
      check(ROLE_SELECTORS.canceller),
      check(ROLE_SELECTORS.admin),
    ]);
    return { proposer, executor, canceller, admin };
  }, []);

  const schedule = useCallback(async (
    addr: string, target: string, selector: string, calldata: string[],
    predecessor: string, salt: string, delay: number,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const response = await account.execute([{
        contractAddress: addr,
        entrypoint: 'schedule',
        calldata: compileCallArgs(target, selector, calldata, predecessor, salt, delay),
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: addr, functionName: 'schedule', functionCall: `schedule({ to: ${target}, selector: ${selector}, calldata: [${calldata.join(', ')}] }, predecessor: ${predecessor}, salt: ${salt}, delay: ${delay})` }) };
    }
  }, [account]);

  const execute = useCallback(async (
    addr: string, target: string, selector: string, calldata: string[],
    predecessor: string, salt: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const response = await account.execute([{
        contractAddress: addr,
        entrypoint: 'execute',
        calldata: compileCallArgs(target, selector, calldata, predecessor, salt),
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: addr, functionName: 'execute', functionCall: `execute({ to: ${target}, selector: ${selector} }, predecessor: ${predecessor}, salt: ${salt})` }) };
    }
  }, [account]);

  const cancel = useCallback(async (addr: string, id: string): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const response = await account.execute([{
        contractAddress: addr,
        entrypoint: 'cancel',
        calldata: CallData.compile([id]),
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: addr, functionName: 'cancel', functionCall: `cancel(${id})` }) };
    }
  }, [account]);

  const grantRole = useCallback(async (addr: string, role: string, grantAddr: string): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const response = await account.execute([{
        contractAddress: addr,
        entrypoint: 'grant_role',
        calldata: CallData.compile([role, grantAddr]),
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: addr, functionName: 'grant_role', functionCall: `grant_role(${role}, ${grantAddr})` }) };
    }
  }, [account]);

  const revokeRole = useCallback(async (addr: string, role: string, revokeAddr: string): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const response = await account.execute([{
        contractAddress: addr,
        entrypoint: 'revoke_role',
        calldata: CallData.compile([role, revokeAddr]),
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: addr, functionName: 'revoke_role', functionCall: `revoke_role(${role}, ${revokeAddr})` }) };
    }
  }, [account]);

  return {
    getMinDelay, getOperationState, getTimestamp, hashOperation, checkRoles,
    schedule, execute, cancel, grantRole, revokeRole,
    roleSelectors: ROLE_SELECTORS,
  };
}
