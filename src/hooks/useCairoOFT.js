import { useCallback } from 'react';
import { RpcProvider, CallData, Contract } from 'starknet';
import StarknetOFTABI from '@/abis/StarknetOFT.json';
/** Convert an EVM address (0x hex) to the Bytes32 low/high calldata for Cairo set_peer. */
function evmAddrToBytes32Calldata(evmAddr) {
    const value = BigInt(evmAddr);
    const low = (value & BigInt('0xffffffffffffffffffffffffffffffff')).toString();
    const high = (value >> BigInt(128)).toString();
    return [low, high];
}
/** Read the peer bytes32 stored for a given EID from a Cairo OFT, returned as a hex string. */
async function readCairoPeer(cairoOftAddr, eid, rpc) {
    try {
        const provider = new RpcProvider({ nodeUrl: rpc });
        const result = await provider.callContract({
            contractAddress: cairoOftAddr,
            entrypoint: 'get_peer',
            calldata: CallData.compile([eid]),
        });
        // result is [low, high] for the Bytes32 value
        const low = BigInt(result[0]);
        const high = BigInt(result[1]);
        const value = (high << BigInt(128)) | low;
        if (value === 0n)
            return null;
        return '0x' + value.toString(16).padStart(64, '0');
    }
    catch {
        return null;
    }
}
export function useCairoOFT(account) {
    const readPeer = useCallback(async (cairoOftAddr, evmEid, rpc) => {
        try {
            const peer = await readCairoPeer(cairoOftAddr, evmEid, rpc);
            return { peer, loading: false, error: null };
        }
        catch (e) {
            return { peer: null, loading: false, error: e instanceof Error ? e.message : String(e) };
        }
    }, []);
    const readAllPeers = useCallback(async (cairoOftAddr, eidList, rpc) => {
        const settled = await Promise.allSettled(eidList.map((item) => readCairoPeer(cairoOftAddr, item.eid, rpc)));
        return eidList.map((item, i) => {
            const res = settled[i];
            if (res.status === 'rejected')
                return { ...item, peer: null, error: true };
            return { ...item, peer: res.value }; // null when zero
        });
    }, []);
    const readEnforcedOptions = useCallback(async (cairoOftAddr, evmEid, rpc) => {
        try {
            const provider = new RpcProvider({ nodeUrl: rpc });
            const contract = new Contract(StarknetOFTABI, cairoOftAddr, provider);
            const result = await contract.get_enforced_options(evmEid, 1 /* MSG_TYPE_SEND */);
            // Cairo ByteArray: result is { data, pending_word, pending_word_len } or array
            // Non-empty = at least one byte in data or pending_word != 0x0
            if (Array.isArray(result)) {
                // [data_len, ...data_felts, pending_word, pending_word_len]
                const dataLen = Number(result[0]);
                const pendingWord = result[1 + dataLen];
                return dataLen > 0 || (pendingWord !== undefined && BigInt(pendingWord) !== 0n);
            }
            if (typeof result === 'object' && result !== null) {
                const r = result;
                return (r.data?.length ?? 0) > 0 || (r.pending_word !== undefined && BigInt(String(r.pending_word)) !== 0n);
            }
            return false;
        }
        catch {
            return false;
        }
    }, []);
    const setPeer = useCallback(async (cairoOftAddr, evmEid, evmBridgeAddr) => {
        if (!account)
            return { status: 'error', message: 'Starknet wallet not connected' };
        try {
            const [low, high] = evmAddrToBytes32Calldata(evmBridgeAddr);
            const response = await account.execute([{
                    contractAddress: cairoOftAddr,
                    entrypoint: 'set_peer',
                    calldata: [evmEid.toString(), low, high],
                }]);
            await account.waitForTransaction(response.transaction_hash);
            return { status: 'success', hash: response.transaction_hash };
        }
        catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    }, [account]);
    return { readPeer, readAllPeers, readEnforcedOptions, setPeer };
}
