import { useCallback } from 'react';
import { Contract, JsonRpcSigner, AbiCoder, ContractRunner } from 'ethers';
import EndpointV2ABI from '@/abis/EndpointV2.json';
import type { TxState } from '@/types';

// configType constants (LZ V2 ULN)
const CONFIG_TYPE_EXECUTOR = 1;
const CONFIG_TYPE_ULN = 2;

export interface ULNConfigParams {
  confirmations: number;
  requiredDVNs: string[];    // addresses, will be sorted ascending (contract requirement)
  optionalDVNs?: string[];
  optionalDVNThreshold?: number;
}

export interface ExecutorConfigParams {
  maxMessageSize: number;
  executor: string;
}

interface IEndpointWrite {
  setSendLibrary(oapp: string, eid: number, newLib: string): Promise<{ wait(): Promise<unknown>; hash: string }>;
  setReceiveLibrary(oapp: string, eid: number, newLib: string, gracePeriod: bigint): Promise<{ wait(): Promise<unknown>; hash: string }>;
  setConfig(oapp: string, lib: string, params: { eid: number; configType: number; config: string }[]): Promise<{ wait(): Promise<unknown>; hash: string }>;
}

function endpointWrite(endpointAddr: string, runner: ContractRunner): IEndpointWrite {
  return new Contract(endpointAddr, EndpointV2ABI, runner) as unknown as IEndpointWrite;
}

/** ABI-encode a ULN config struct for endpoint.setConfig */
function encodeULN(params: ULNConfigParams): string {
  const sorted = [...params.requiredDVNs].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const optDVNs = params.optionalDVNs ?? [];
  const coder = AbiCoder.defaultAbiCoder();
  return coder.encode(
    ['tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)'],
    [{
      confirmations: BigInt(params.confirmations),
      requiredDVNCount: sorted.length,
      optionalDVNCount: optDVNs.length,
      optionalDVNThreshold: params.optionalDVNThreshold ?? 0,
      requiredDVNs: sorted,
      optionalDVNs: optDVNs,
    }],
  );
}

/** ABI-encode an Executor config struct for endpoint.setConfig */
function encodeExecutor(params: ExecutorConfigParams): string {
  const coder = AbiCoder.defaultAbiCoder();
  return coder.encode(
    ['tuple(uint32 maxMessageSize,address executorAddress)'],
    [{ maxMessageSize: params.maxMessageSize, executorAddress: params.executor }],
  );
}

interface EndpointConfig {
  /**
   * Set the send library on the home chain endpoint.
   * Must be called by the OApp owner or delegate, on the home chain.
   */
  setSendLib: (endpointAddr: string, oapp: string, remoteEid: number, lib: string) => Promise<TxState>;
  /**
   * Set the receive library on the remote chain endpoint.
   * Must be called by the OApp owner or delegate, on the remote chain.
   */
  setReceiveLib: (endpointAddr: string, oapp: string, srcEid: number, lib: string) => Promise<TxState>;
  /**
   * Set ULN (DVN) config. One call sets both executor and ULN in one tx.
   * - For the send side: call on the home chain endpoint with the home send lib and remoteEid.
   * - For the receive side: call on the remote chain endpoint with the remote receive lib and homeEid.
   */
  setULNConfig: (
    endpointAddr: string,
    oapp: string,
    lib: string,
    eid: number,
    uln: ULNConfigParams,
    executor?: ExecutorConfigParams,
  ) => Promise<TxState>;
}

export function useEndpointConfig(signer: JsonRpcSigner | null): EndpointConfig {
  const setSendLib = useCallback(
    async (endpointAddr: string, oapp: string, remoteEid: number, lib: string): Promise<TxState> => {
      if (!signer) return { status: 'error', message: 'Wallet not connected' };
      try {
        const ep = endpointWrite(endpointAddr, signer);
        const tx = await ep.setSendLibrary(oapp, remoteEid, lib);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    },
    [signer],
  );

  const setReceiveLib = useCallback(
    async (endpointAddr: string, oapp: string, srcEid: number, lib: string): Promise<TxState> => {
      if (!signer) return { status: 'error', message: 'Wallet not connected' };
      try {
        const ep = endpointWrite(endpointAddr, signer);
        const tx = await ep.setReceiveLibrary(oapp, srcEid, lib, 0n);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    },
    [signer],
  );

  const setULNConfig = useCallback(
    async (
      endpointAddr: string,
      oapp: string,
      lib: string,
      eid: number,
      uln: ULNConfigParams,
      executor?: ExecutorConfigParams,
    ): Promise<TxState> => {
      if (!signer) return { status: 'error', message: 'Wallet not connected' };
      try {
        const ep = endpointWrite(endpointAddr, signer);
        const params: { eid: number; configType: number; config: string }[] = [
          { eid, configType: CONFIG_TYPE_ULN, config: encodeULN(uln) },
        ];
        if (executor) {
          params.unshift({ eid, configType: CONFIG_TYPE_EXECUTOR, config: encodeExecutor(executor) });
        }
        const tx = await ep.setConfig(oapp, lib, params);
        await tx.wait();
        return { status: 'success', hash: tx.hash };
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    },
    [signer],
  );

  return { setSendLib, setReceiveLib, setULNConfig };
}
