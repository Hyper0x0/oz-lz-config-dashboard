import { useCallback } from 'react';
import { Contract, RpcProvider } from 'starknet';
import { buildLzReceiveOption } from '@/utils/lzOptions';
import { CONFIG_TYPE_EXECUTOR, CONFIG_TYPE_ULN, encodeUlnConfig, encodeExecutorConfig } from '@/utils/cairoLzConfig';
import StarknetOFTABI from '@/abis/StarknetOFT.json';
import StarknetEndpointABI from '@/abis/StarknetEndpoint.json';
const MSG_TYPE_SEND = 1;
/**
 * Convert raw hex bytes (e.g. from buildLzReceiveOption) into a starknet.js
 * ByteArray object { data, pending_word, pending_word_len }.
 * Cairo ByteArray stores bytes in 31-byte felts; the remainder goes in pending_word.
 */
function hexToByteArray(hex) {
    const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
    const padded = raw.length % 2 ? '0' + raw : raw;
    const data = [];
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
export function useCairoEndpoint(account) {
    const setEnforcedOptions = useCallback(async (oappAddr, remoteEid, gasLimit, rpc) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetOFTABI, oappAddr, provider);
            contract.connect(account);
            const options = hexToByteArray(buildLzReceiveOption(gasLimit));
            const tx = await contract.set_enforced_options([
                { eid: remoteEid, msg_type: MSG_TYPE_SEND, options },
            ]);
            await account.waitForTransaction(tx.transaction_hash);
            return { status: 'success', hash: tx.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    const setLibraries = useCallback(async (endpointAddr, oappAddr, remoteEid, libAddr, gracePeriod, rpc) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            // Batch both calls in a single transaction
            const sendCall = contract.populate('set_send_library', [oappAddr, remoteEid, libAddr]);
            const recvCall = contract.populate('set_receive_library', [oappAddr, remoteEid, libAddr, gracePeriod]);
            const response = await account.execute([sendCall, recvCall]);
            await account.waitForTransaction(response.transaction_hash);
            return { status: 'success', hash: response.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    const setSendLibrary = useCallback(async (endpointAddr, oappAddr, remoteEid, libAddr, rpc) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            contract.connect(account);
            const tx = await contract.set_send_library(oappAddr, remoteEid, libAddr);
            await account.waitForTransaction(tx.transaction_hash);
            return { status: 'success', hash: tx.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    const setReceiveLibrary = useCallback(async (endpointAddr, oappAddr, remoteEid, libAddr, gracePeriod, rpc) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            contract.connect(account);
            const tx = await contract.set_receive_library(oappAddr, remoteEid, libAddr, gracePeriod);
            await account.waitForTransaction(tx.transaction_hash);
            return { status: 'success', hash: tx.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    const setUlnSendConfig = useCallback(async (endpointAddr, oappAddr, libAddr, remoteEid, params, rpc) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            contract.connect(account);
            const config = encodeUlnConfig(params);
            const tx = await contract.set_send_configs(oappAddr, libAddr, [
                { eid: remoteEid, config_type: CONFIG_TYPE_ULN, config },
            ]);
            await account.waitForTransaction(tx.transaction_hash);
            return { status: 'success', hash: tx.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    const setUlnReceiveConfig = useCallback(async (endpointAddr, oappAddr, libAddr, remoteEid, params, rpc) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            contract.connect(account);
            const config = encodeUlnConfig(params);
            const tx = await contract.set_receive_configs(oappAddr, libAddr, [
                { eid: remoteEid, config_type: CONFIG_TYPE_ULN, config },
            ]);
            await account.waitForTransaction(tx.transaction_hash);
            return { status: 'success', hash: tx.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    const setExecutorConfig = useCallback(async (endpointAddr, oappAddr, libAddr, remoteEid, params, rpc) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            contract.connect(account);
            const config = encodeExecutorConfig(params);
            const tx = await contract.set_send_configs(oappAddr, libAddr, [
                { eid: remoteEid, config_type: CONFIG_TYPE_EXECUTOR, config },
            ]);
            await account.waitForTransaction(tx.transaction_hash);
            return { status: 'success', hash: tx.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    const setDelegate = useCallback(async (oappAddr, delegateAddr, rpc) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetOFTABI, oappAddr, provider);
            contract.connect(account);
            const tx = await contract.set_delegate(delegateAddr);
            await account.waitForTransaction(tx.transaction_hash);
            return { status: 'success', hash: tx.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    const readSendLibrary = useCallback(async (endpointAddr, oappAddr, eid, rpc) => {
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            const result = await contract.get_send_library(oappAddr, eid);
            // Returns GetLibraryResponse { lib, is_default } or raw address depending on starknet.js version
            const addr = typeof result === 'object' && result !== null && 'lib' in result
                ? String(result.lib)
                : String(result);
            return addr === '0x0' || addr === '0' ? null : addr;
        }
        catch {
            return null;
        }
    }, []);
    const readReceiveLibrary = useCallback(async (endpointAddr, oappAddr, eid, rpc) => {
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            const result = await contract.get_receive_library(oappAddr, eid);
            // Returns GetLibraryResponse { lib, is_default }
            let lib;
            let isDefault;
            if (typeof result === 'object' && result !== null && 'lib' in result) {
                const r = result;
                lib = String(r.lib);
                isDefault = Boolean(r.is_default);
            }
            else if (Array.isArray(result)) {
                lib = String(result[0]);
                isDefault = Boolean(result[1]);
            }
            else {
                lib = String(result);
                isDefault = false;
            }
            return { lib: lib === '0x0' || lib === '0' ? null : lib, isDefault };
        }
        catch {
            return { lib: null, isDefault: false };
        }
    }, []);
    const readDelegate = useCallback(async (endpointAddr, oappAddr, rpc) => {
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetEndpointABI, endpointAddr, provider);
            const result = await contract.get_delegate(oappAddr);
            const addr = typeof result === 'string' ? result : String(result);
            return addr === '0x0' || addr === '0' ? null : addr;
        }
        catch {
            return null;
        }
    }, []);
    return {
        setEnforcedOptions, setLibraries, setSendLibrary, setReceiveLibrary,
        setUlnSendConfig, setUlnReceiveConfig, setExecutorConfig,
        setDelegate, readSendLibrary, readReceiveLibrary, readDelegate,
    };
}
