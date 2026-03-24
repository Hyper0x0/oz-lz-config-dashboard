import { useCallback } from 'react';
import { Contract, JsonRpcProvider, ZeroHash } from 'ethers';
import TimelockControllerABI from '@/abis/TimelockController.json';
import { operationStateLabel } from '@/utils/timelock';
import { ARB_SEPOLIA } from '@/config/chains';
const ZERO_BYTES32 = ZeroHash;
function timelockContract(addr, runner) {
    return new Contract(addr, TimelockControllerABI, runner);
}
export function useTimelockOps(signer) {
    const schedule = useCallback(async (target, value, data, predecessor, salt, delay) => {
        if (!signer)
            return { status: 'error', message: 'Wallet not connected' };
        const contract = timelockContract(target, signer);
        try {
            const tx = await contract.schedule(target, value, data, predecessor || ZERO_BYTES32, salt, delay);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: String(err instanceof Error ? err.message : err) };
        }
    }, [signer]);
    const execute = useCallback(async (target, value, data, predecessor, salt) => {
        if (!signer)
            return { status: 'error', message: 'Wallet not connected' };
        const contract = timelockContract(target, signer);
        try {
            const tx = await contract.execute(target, value, data, predecessor || ZERO_BYTES32, salt);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: String(err instanceof Error ? err.message : err) };
        }
    }, [signer]);
    const cancel = useCallback(async (adminGatewayAddr, id) => {
        if (!signer)
            return { status: 'error', message: 'Wallet not connected' };
        const contract = timelockContract(adminGatewayAddr, signer);
        try {
            const tx = await contract.cancel(id);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: String(err instanceof Error ? err.message : err) };
        }
    }, [signer]);
    function readProvider(walletProvider) {
        return walletProvider ?? new JsonRpcProvider(ARB_SEPOLIA.rpc);
    }
    const getMinDelay = useCallback(async (timelockAddr, walletProvider) => {
        return timelockContract(timelockAddr, readProvider(walletProvider)).getMinDelay();
    }, []);
    const getOperationState = useCallback(async (timelockAddr, id, walletProvider) => {
        const state = await timelockContract(timelockAddr, readProvider(walletProvider)).getOperationState(id);
        return operationStateLabel(state);
    }, []);
    const getTimestamp = useCallback(async (timelockAddr, id, walletProvider) => {
        return timelockContract(timelockAddr, readProvider(walletProvider)).getTimestamp(id);
    }, []);
    return { schedule, execute, cancel, getMinDelay, getOperationState, getTimestamp };
}
