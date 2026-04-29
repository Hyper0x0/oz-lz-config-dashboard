import { useCallback } from 'react';
import { Contract, RpcProvider, CallData } from 'starknet';
import type { WalletAccount } from 'starknet';
import type { TxState } from '@/types';
import { decodeContractError, extractErrorDetails } from '@/utils/decodeError';
import { buildLzReceiveOption } from '@/utils/lzOptions';

/** Classify a Starknet RPC error into a kind the caller can branch on. */
function classifyStarkRpcError(e: unknown): 'entrypoint_missing' | 'contract_missing' | 'rpc_error' {
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  if (msg.includes('entrypoint') || msg.includes('entry point') || msg.includes('not exist in the contract')) return 'entrypoint_missing';
  if ((msg.includes('contract') && msg.includes('not found')) || msg.includes('class hash')) return 'contract_missing';
  return 'rpc_error';
}

/** Retry an RPC call on transient errors (up to 3 attempts, 250ms/500ms/750ms backoff). */
async function retryOnRpcFlake<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (classifyStarkRpcError(e) !== 'rpc_error') throw e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}
import {
  CONFIG_TYPE_EXECUTOR, CONFIG_TYPE_ULN,
  type UlnConfigParams, type ExecutorConfigParams,
  encodeUlnConfig, encodeExecutorConfig,
  decodeStarknetUln, decodeStarknetExecutor,
  type DecodedStarknetUln, type DecodedStarknetExecutor,
} from '@/utils/cairoLzConfig';
import StarknetOFTABI from '@/abis/svm/OFT.json';
import StarknetEndpointABI from '@/abis/svm/EndpointV2.json';

const MSG_TYPE_SEND = 1;

/**
 * Convert raw hex bytes (e.g. from buildLzReceiveOption) into a starknet.js
 * ByteArray object { data, pending_word, pending_word_len }.
 * Cairo ByteArray stores bytes in 31-byte felts; the remainder goes in pending_word.
 */
function hexToByteArray(hex: string): { data: string[]; pending_word: string; pending_word_len: number } {
  const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
  const padded = raw.length % 2 ? '0' + raw : raw;

  const data: string[] = [];
  let i = 0;
  while (i + 62 <= padded.length) {
    data.push('0x' + padded.slice(i, i + 62));
    i += 62;
  }
  const rem = padded.slice(i);
  return {
    data,
    pending_word: rem ? '0x' + rem : '0x0',
    pending_word_len: rem.length / 2,
  };
}

export interface CairoEndpointOps {
  /** Set enforced options (lzReceive gas limit) on the Starknet OFT for a remote EID. */
  setEnforcedOptions: (oappAddr: string, remoteEid: number, gasLimit: bigint, rpc: string) => Promise<TxState>;
  /** Set both send and receive libraries in a single batched transaction. */
  setLibraries: (endpointAddr: string, oappAddr: string, remoteEid: number, libAddr: string, gracePeriod: number, rpc: string) => Promise<TxState>;
  /** Set the send library on the Starknet Endpoint for this OApp. */
  setSendLibrary: (endpointAddr: string, oappAddr: string, remoteEid: number, libAddr: string, rpc: string) => Promise<TxState>;
  /** Set the receive library on the Starknet Endpoint for this OApp. grace_period=0 = immediate. */
  setReceiveLibrary: (endpointAddr: string, oappAddr: string, remoteEid: number, libAddr: string, gracePeriod: number, rpc: string) => Promise<TxState>;
  /**
   * Set ULN send config + executor config atomically in one set_send_configs call.
   * The LZ SDK recommends combining these to avoid partial configuration state.
   */
  setSendConfigsAtomic: (endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number, uln: UlnConfigParams, executor: ExecutorConfigParams, rpc: string) => Promise<TxState>;
  /**
   * Set ULN send config + executor config + ULN receive config in a single multicall tx.
   * On Starknet sendLib === recvLib so this configures the entire DVN flow in one click.
   */
  setUlnConfigsBoth: (endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number, uln: UlnConfigParams, executor: ExecutorConfigParams, rpc: string) => Promise<TxState>;
  /** Set ULN send config (DVNs + confirmations) on the Starknet Endpoint. */
  setUlnSendConfig: (endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number, params: UlnConfigParams, rpc: string) => Promise<TxState>;
  /** Set ULN receive config (DVNs + confirmations) on the Starknet Endpoint. */
  setUlnReceiveConfig: (endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number, params: UlnConfigParams, rpc: string) => Promise<TxState>;
  /** Set Executor config (maxMessageSize + executor address) on the Starknet Endpoint. */
  setExecutorConfig: (endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number, params: ExecutorConfigParams, rpc: string) => Promise<TxState>;
  /** Set the delegate on the Starknet OFT (delegates endpoint config to a third party). */
  setDelegate: (oappAddr: string, delegateAddr: string, rpc: string) => Promise<TxState>;
  // ── Read ───────────────────────────────────────────────────────────────────
  readSendLibrary: (endpointAddr: string, oappAddr: string, eid: number, rpc: string) => Promise<string | null>;
  readReceiveLibrary: (endpointAddr: string, oappAddr: string, eid: number, rpc: string) => Promise<{ lib: string | null; isDefault: boolean }>;
  readDelegate: (endpointAddr: string, oappAddr: string, rpc: string) => Promise<string | null>;
  /** Read ULN config (DVNs + confirmations) from the send library for a given remote EID. */
  readSendUlnConfig: (endpointAddr: string, oappAddr: string, libAddr: string, eid: number, rpc: string) => Promise<DecodedStarknetUln | null>;
  /** Read executor config from the send library for a given remote EID. */
  readSendExecutorConfig: (endpointAddr: string, oappAddr: string, libAddr: string, eid: number, rpc: string) => Promise<DecodedStarknetExecutor | null>;
  /** Read ULN config (DVNs + confirmations) from the receive library for a given remote EID. */
  readReceiveUlnConfig: (endpointAddr: string, oappAddr: string, libAddr: string, eid: number, rpc: string) => Promise<DecodedStarknetUln | null>;
}

export function useCairoEndpoint(account: WalletAccount | null): CairoEndpointOps {

  const setEnforcedOptions = useCallback(async (
    oappAddr: string, remoteEid: number, gasLimit: bigint, _rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const options = hexToByteArray(buildLzReceiveOption(gasLimit));
      // Manually compile calldata — starknet.js v6 cannot auto-serialize a
      // ByteArray nested inside a struct, so we flatten it ourselves.
      const calldata: string[] = [
        '1',                                   // params array length
        remoteEid.toString(),                   // EnforcedOptionParam.eid
        MSG_TYPE_SEND.toString(),               // EnforcedOptionParam.msg_type
        options.data.length.toString(),          // ByteArray.data length
        ...options.data,                         // ByteArray.data felts
        options.pending_word,                    // ByteArray.pending_word
        options.pending_word_len.toString(),     // ByteArray.pending_word_len
      ];

      const tx = await account.execute({
        contractAddress: oappAddr,
        entrypoint: 'set_enforced_options',
        calldata,
      });
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: oappAddr, functionName: 'set_enforced_options', functionCall: `set_enforced_options([{ eid: ${remoteEid}, msg_type: ${MSG_TYPE_SEND}, gas: ${gasLimit} }])` }) };
    }
  }, [account]);

  const setLibraries = useCallback(async (
    endpointAddr: string, oappAddr: string, remoteEid: number, libAddr: string, gracePeriod: number, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetEndpointABI as never[], endpointAddr, provider);
      // Batch both calls in a single transaction
      const sendCall = contract.populate('set_send_library', [oappAddr, remoteEid, libAddr]);
      const recvCall = contract.populate('set_receive_library', [oappAddr, remoteEid, libAddr, gracePeriod]);
      const response = await account.execute([sendCall, recvCall]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: endpointAddr, functionName: 'set_send_library + set_receive_library', functionCall: `set_send_library(${oappAddr}, ${remoteEid}, ${libAddr}) + set_receive_library(${oappAddr}, ${remoteEid}, ${libAddr}, ${gracePeriod})` }) };
    }
  }, [account]);

  const setSendConfigsAtomic = useCallback(async (
    endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number,
    uln: UlnConfigParams, executor: ExecutorConfigParams, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetEndpointABI as never[], endpointAddr, provider);
      contract.connect(account);
      // Combine ULN + Executor in one atomic set_send_configs call (LZ SDK recommendation)
      const tx = await contract.set_send_configs(oappAddr, libAddr, [
        { eid: remoteEid, config_type: CONFIG_TYPE_ULN,      config: encodeUlnConfig(uln) },
        { eid: remoteEid, config_type: CONFIG_TYPE_EXECUTOR, config: encodeExecutorConfig(executor) },
      ]);
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: endpointAddr, functionName: 'set_send_configs (ULN + Executor)', functionCall: `set_send_configs(${oappAddr}, ${libAddr}, [{ eid: ${remoteEid}, ULN: { dvns: [${uln.requiredDvns.join(', ')}], confirmations: ${uln.confirmations} } }, { eid: ${remoteEid}, Executor: { executor: ${executor.executor}, maxMsgSize: ${executor.maxMessageSize} } }])` }) };
    }
  }, [account]);

  const setUlnConfigsBoth = useCallback(async (
    endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number,
    uln: UlnConfigParams, executor: ExecutorConfigParams, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetEndpointABI as never[], endpointAddr, provider);
      // Build both calls and execute as a single multicall.
      const sendCall = contract.populate('set_send_configs', [oappAddr, libAddr, [
        { eid: remoteEid, config_type: CONFIG_TYPE_ULN,      config: encodeUlnConfig(uln) },
        { eid: remoteEid, config_type: CONFIG_TYPE_EXECUTOR, config: encodeExecutorConfig(executor) },
      ]]);
      const recvCall = contract.populate('set_receive_configs', [oappAddr, libAddr, [
        { eid: remoteEid, config_type: CONFIG_TYPE_ULN, config: encodeUlnConfig(uln) },
      ]]);
      const tx = await account.execute([sendCall, recvCall]);
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: endpointAddr, functionName: 'set_send_configs + set_receive_configs', functionCall: `setUlnConfigsBoth(${oappAddr}, ${libAddr}, eid: ${remoteEid}, dvns: [${uln.requiredDvns.join(', ')}], confirmations: ${uln.confirmations}, executor: ${executor.executor})` }) };
    }
  }, [account]);

  const setSendLibrary = useCallback(async (
    endpointAddr: string, oappAddr: string, remoteEid: number, libAddr: string, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetEndpointABI as never[], endpointAddr, provider);
      contract.connect(account);
      const tx = await contract.set_send_library(oappAddr, remoteEid, libAddr);
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: endpointAddr, functionName: 'set_send_library', functionCall: `set_send_library(${oappAddr}, ${remoteEid}, ${libAddr})` }) };
    }
  }, [account]);

  const setReceiveLibrary = useCallback(async (
    endpointAddr: string, oappAddr: string, remoteEid: number, libAddr: string, gracePeriod: number, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetEndpointABI as never[], endpointAddr, provider);
      contract.connect(account);
      const tx = await contract.set_receive_library(oappAddr, remoteEid, libAddr, gracePeriod);
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: endpointAddr, functionName: 'set_receive_library', functionCall: `set_receive_library(${oappAddr}, ${remoteEid}, ${libAddr}, ${gracePeriod})` }) };
    }
  }, [account]);

  const setUlnSendConfig = useCallback(async (
    endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number, params: UlnConfigParams, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetEndpointABI as never[], endpointAddr, provider);
      contract.connect(account);
      const config = encodeUlnConfig(params);
      const tx = await contract.set_send_configs(oappAddr, libAddr, [
        { eid: remoteEid, config_type: CONFIG_TYPE_ULN, config },
      ]);
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: endpointAddr, functionName: 'set_send_configs (ULN)', functionCall: `set_send_configs(${oappAddr}, ${libAddr}, [{ eid: ${remoteEid}, ULN: { dvns: [${params.requiredDvns.join(', ')}], confirmations: ${params.confirmations} } }])` }) };
    }
  }, [account]);

  const setUlnReceiveConfig = useCallback(async (
    endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number, params: UlnConfigParams, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetEndpointABI as never[], endpointAddr, provider);
      contract.connect(account);
      const config = encodeUlnConfig(params);
      const tx = await contract.set_receive_configs(oappAddr, libAddr, [
        { eid: remoteEid, config_type: CONFIG_TYPE_ULN, config },
      ]);
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: endpointAddr, functionName: 'set_receive_configs (ULN)', functionCall: `set_receive_configs(${oappAddr}, ${libAddr}, [{ eid: ${remoteEid}, ULN: { dvns: [${params.requiredDvns.join(', ')}], confirmations: ${params.confirmations} } }])` }) };
    }
  }, [account]);

  const setExecutorConfig = useCallback(async (
    endpointAddr: string, oappAddr: string, libAddr: string, remoteEid: number, params: ExecutorConfigParams, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetEndpointABI as never[], endpointAddr, provider);
      contract.connect(account);
      const config = encodeExecutorConfig(params);
      const tx = await contract.set_send_configs(oappAddr, libAddr, [
        { eid: remoteEid, config_type: CONFIG_TYPE_EXECUTOR, config },
      ]);
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: endpointAddr, functionName: 'set_send_configs (Executor)', functionCall: `set_send_configs(${oappAddr}, ${libAddr}, [{ eid: ${remoteEid}, Executor: { executor: ${params.executor}, maxMsgSize: ${params.maxMessageSize} } }])` }) };
    }
  }, [account]);

  const setDelegate = useCallback(async (
    oappAddr: string, delegateAddr: string, rpc: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const contract = new Contract(StarknetOFTABI as never[], oappAddr, provider);
      contract.connect(account);
      const tx = await contract.set_delegate(delegateAddr);
      await account.waitForTransaction(tx.transaction_hash);
      return { status: 'success', hash: tx.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: oappAddr, functionName: 'set_delegate', functionCall: `set_delegate(${delegateAddr})` }) };
    }
  }, [account]);

  const readSendLibrary = useCallback(async (
    endpointAddr: string, oappAddr: string, eid: number, rpc: string,
  ): Promise<string | null> => {
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      // get_send_library returns GetLibraryResponse { lib: ContractAddress, is_default: bool }
      // raw calldata result: [lib_felt, is_default_variant]
      const result = await provider.callContract({
        contractAddress: endpointAddr,
        entrypoint: 'get_send_library',
        calldata: CallData.compile([oappAddr, eid]),
      }, 'latest');
      const addr = result[0];
      return BigInt(addr) === 0n ? null : addr;
    } catch {
      return null;
    }
  }, []);

  const readReceiveLibrary = useCallback(async (
    endpointAddr: string, oappAddr: string, eid: number, rpc: string,
  ): Promise<{ lib: string | null; isDefault: boolean }> => {
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      // get_receive_library returns GetLibraryResponse { lib: ContractAddress, is_default: bool }
      // raw calldata result: [lib_felt, is_default_variant (0=False, 1=True)]
      const result = await provider.callContract({
        contractAddress: endpointAddr,
        entrypoint: 'get_receive_library',
        calldata: CallData.compile([oappAddr, eid]),
      }, 'latest');
      const addr = result[0];
      const isDefault = BigInt(result[1]) !== 0n;
      return { lib: BigInt(addr) === 0n ? null : addr, isDefault };
    } catch {
      return { lib: null, isDefault: false };
    }
  }, []);

  const readDelegate = useCallback(async (
    endpointAddr: string, oappAddr: string, rpc: string,
  ): Promise<string | null> => {
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      // get_delegate returns ContractAddress → raw result: [addr_felt]
      const result = await provider.callContract({
        contractAddress: endpointAddr,
        entrypoint: 'get_delegate',
        calldata: CallData.compile([oappAddr]),
      }, 'latest');
      const addr = result[0];
      return BigInt(addr) === 0n ? null : addr;
    } catch {
      return null;
    }
  }, []);

  const readSendUlnConfig = useCallback(async (
    endpointAddr: string, oappAddr: string, libAddr: string, eid: number, rpc: string,
  ): Promise<DecodedStarknetUln | null> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    try {
      const result = await retryOnRpcFlake(() => provider.callContract({
        contractAddress: endpointAddr,
        entrypoint: 'get_send_config',
        calldata: CallData.compile([oappAddr, libAddr, eid, CONFIG_TYPE_ULN]),
      }, 'latest'));
      return decodeStarknetUln(result);
    } catch (e) {
      console.warn('[cairoEndpoint] readSendUlnConfig failed:', (e as Error)?.message ?? e);
      return null;
    }
  }, []);

  const readSendExecutorConfig = useCallback(async (
    endpointAddr: string, oappAddr: string, libAddr: string, eid: number, rpc: string,
  ): Promise<DecodedStarknetExecutor | null> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    try {
      const result = await retryOnRpcFlake(() => provider.callContract({
        contractAddress: endpointAddr,
        entrypoint: 'get_send_config',
        calldata: CallData.compile([oappAddr, libAddr, eid, CONFIG_TYPE_EXECUTOR]),
      }, 'latest'));
      return decodeStarknetExecutor(result);
    } catch (e) {
      console.warn('[cairoEndpoint] readSendExecutorConfig failed:', (e as Error)?.message ?? e);
      return null;
    }
  }, []);

  const readReceiveUlnConfig = useCallback(async (
    endpointAddr: string, oappAddr: string, libAddr: string, eid: number, rpc: string,
  ): Promise<DecodedStarknetUln | null> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    try {
      const result = await retryOnRpcFlake(() => provider.callContract({
        contractAddress: endpointAddr,
        entrypoint: 'get_receive_config',
        calldata: CallData.compile([oappAddr, libAddr, eid, CONFIG_TYPE_ULN]),
      }, 'latest'));
      return decodeStarknetUln(result);
    } catch (e) {
      console.warn('[cairoEndpoint] readReceiveUlnConfig failed:', (e as Error)?.message ?? e);
      return null;
    }
  }, []);

  return {
    setEnforcedOptions, setLibraries, setSendLibrary, setReceiveLibrary,
    setSendConfigsAtomic, setUlnConfigsBoth, setUlnSendConfig, setUlnReceiveConfig, setExecutorConfig,
    setDelegate, readSendLibrary, readReceiveLibrary, readDelegate,
    readSendUlnConfig, readSendExecutorConfig, readReceiveUlnConfig,
  };
}
