import { useCallback } from 'react';
import { Contract, AbiCoder } from 'ethers';
import EndpointV2ABI from '@/abis/EndpointV2.json';
// configType constants (LZ V2 ULN)
const CONFIG_TYPE_EXECUTOR = 1;
const CONFIG_TYPE_ULN = 2;
function endpointWrite(endpointAddr, runner) {
    return new Contract(endpointAddr, EndpointV2ABI, runner);
}
/** ABI-encode a ULN config struct for endpoint.setConfig */
function encodeULN(params) {
    const sorted = [...params.requiredDVNs].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const optDVNs = params.optionalDVNs ?? [];
    const coder = AbiCoder.defaultAbiCoder();
    return coder.encode(['tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)'], [{
            confirmations: BigInt(params.confirmations),
            requiredDVNCount: sorted.length,
            optionalDVNCount: optDVNs.length,
            optionalDVNThreshold: params.optionalDVNThreshold ?? 0,
            requiredDVNs: sorted,
            optionalDVNs: optDVNs,
        }]);
}
/** ABI-encode an Executor config struct for endpoint.setConfig */
function encodeExecutor(params) {
    const coder = AbiCoder.defaultAbiCoder();
    return coder.encode(['tuple(uint32 maxMessageSize,address executorAddress)'], [{ maxMessageSize: params.maxMessageSize, executorAddress: params.executor }]);
}
export function useEndpointConfig(signer) {
    const setSendLib = useCallback(async (endpointAddr, oapp, remoteEid, lib) => {
        if (!signer)
            return { status: 'error', message: 'Wallet not connected' };
        try {
            const ep = endpointWrite(endpointAddr, signer);
            const tx = await ep.setSendLibrary(oapp, remoteEid, lib);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: err instanceof Error ? err.message : String(err) };
        }
    }, [signer]);
    const setReceiveLib = useCallback(async (endpointAddr, oapp, srcEid, lib) => {
        if (!signer)
            return { status: 'error', message: 'Wallet not connected' };
        try {
            const ep = endpointWrite(endpointAddr, signer);
            const tx = await ep.setReceiveLibrary(oapp, srcEid, lib, 0n);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: err instanceof Error ? err.message : String(err) };
        }
    }, [signer]);
    const setULNConfig = useCallback(async (endpointAddr, oapp, lib, eid, uln, executor) => {
        if (!signer)
            return { status: 'error', message: 'Wallet not connected' };
        try {
            const ep = endpointWrite(endpointAddr, signer);
            const params = [
                { eid, configType: CONFIG_TYPE_ULN, config: encodeULN(uln) },
            ];
            if (executor) {
                params.unshift({ eid, configType: CONFIG_TYPE_EXECUTOR, config: encodeExecutor(executor) });
            }
            const tx = await ep.setConfig(oapp, lib, params);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: err instanceof Error ? err.message : String(err) };
        }
    }, [signer]);
    return { setSendLib, setReceiveLib, setULNConfig };
}
