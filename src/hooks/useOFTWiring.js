import { useCallback } from 'react';
import { Contract, JsonRpcProvider } from 'ethers';
import OFTAdapterABI from '@/abis/OFTAdapter.json';
import OFTABI from '@/abis/OFT.json';
import ERC20ABI from '@/abis/ERC20.json';
import { buildLzReceiveOption } from '@/utils/lzOptions';
import { feltToBytes32, evmToFelt } from '@/utils/cairoAddress';
const SEND_MSG_TYPE = 1;
function adapterContract(addr, signerOrProvider) {
    return new Contract(addr, OFTAdapterABI, signerOrProvider);
}
function peerContract(addr, signerOrProvider) {
    return new Contract(addr, OFTABI, signerOrProvider);
}
export function useOFTWiring(evmSigner) {
    // ── Read ──────────────────────────────────────────────────────────────────
    const readTokenInfo = useCallback(async (adapterAddr, peerAddr, homeRpc, remoteRpc, walletProvider) => {
        const homeProvider = walletProvider ?? new JsonRpcProvider(homeRpc);
        const remoteProvider = new JsonRpcProvider(remoteRpc);
        const adapter = adapterContract(adapterAddr, homeProvider);
        const peer = peerContract(peerAddr, remoteProvider);
        const tokenAddr = await adapter.token();
        const erc20 = new Contract(tokenAddr, ERC20ABI, homeProvider);
        const [tokenName, tokenSymbol, peerName, peerSymbol] = await Promise.all([
            erc20.name(),
            erc20.symbol(),
            peer.name(),
            peer.symbol(),
        ]);
        return { tokenName, tokenSymbol, peerName, peerSymbol };
    }, []);
    const readEvmSideInfo = useCallback(async (addr, rpc, isAdapterSide) => {
        const provider = new JsonRpcProvider(rpc);
        if (isAdapterSide) {
            const adapter = adapterContract(addr, provider);
            const tokenAddr = await adapter.token();
            const erc20 = new Contract(tokenAddr, ERC20ABI, provider);
            const [name, symbol] = await Promise.all([erc20.name(), erc20.symbol()]);
            return { name, symbol };
        }
        const oft = peerContract(addr, provider);
        const [name, symbol] = await Promise.all([oft.name(), oft.symbol()]);
        return { name, symbol };
    }, []);
    const readAdapterState = useCallback(async (adapterAddr, peerEid, homeRpc) => {
        const provider = new JsonRpcProvider(homeRpc);
        const c = adapterContract(adapterAddr, provider);
        const [owner, token, peer, opts, rl, flight] = await Promise.all([
            c.owner(),
            c.token(),
            c.peers(peerEid),
            c.enforcedOptions(peerEid, SEND_MSG_TYPE),
            c.rateLimits(peerEid),
            c.getAmountCanBeSent(peerEid),
        ]);
        return {
            owner,
            token,
            peer,
            enforcedOptionsSend: opts,
            rateLimit: {
                amountInFlight: rl[0],
                lastUpdated: Number(rl[1]),
                limit: rl[2],
                window: Number(rl[3]),
            },
            amountInFlight: flight[0],
            amountCanBeSent: flight[1],
        };
    }, []);
    const readPeerState = useCallback(async (peerAddr, adapterEid, remoteRpc) => {
        const provider = new JsonRpcProvider(remoteRpc);
        const c = peerContract(peerAddr, provider);
        const [owner, peer, opts] = await Promise.all([
            c.owner(),
            c.peers(adapterEid),
            c.enforcedOptions(adapterEid, SEND_MSG_TYPE),
        ]);
        return { owner, peer, enforcedOptionsSend: opts };
    }, []);
    const readAllPeers = useCallback(async (bridgeAddr, homeRpc, eidList) => {
        const provider = new JsonRpcProvider(homeRpc);
        const c = adapterContract(bridgeAddr, provider);
        const settled = await Promise.allSettled(eidList.map((item) => c.peers(item.eid)));
        const ZERO = /^0x0+$/;
        return eidList.map((item, i) => {
            const res = settled[i];
            if (res.status === 'rejected')
                return { ...item, peer: null, error: true };
            const bytes32 = res.value;
            return { ...item, peer: ZERO.test(bytes32) ? null : bytes32 };
        });
    }, []);
    // ── Write — EVM ───────────────────────────────────────────────────────────
    const setEvmPeer = useCallback(async (contractAddr, peerEid, peerAddr) => {
        if (!evmSigner)
            return { status: 'error', message: 'Wallet not connected' };
        const peerBytes32 = '0x' + BigInt(peerAddr).toString(16).padStart(64, '0');
        try {
            // Both adapter and peer expose the same setPeer interface
            const c = adapterContract(contractAddr, evmSigner);
            const tx = await c.setPeer(peerEid, peerBytes32);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: String(err instanceof Error ? err.message : err) };
        }
    }, [evmSigner]);
    const setEvmPeerToCairo = useCallback(async (adapterAddr, cairoEid, cairoAddrFelt) => {
        if (!evmSigner)
            return { status: 'error', message: 'Wallet not connected' };
        const peerBytes32 = feltToBytes32(evmToFelt(cairoAddrFelt));
        try {
            const c = adapterContract(adapterAddr, evmSigner);
            const tx = await c.setPeer(cairoEid, peerBytes32);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: String(err instanceof Error ? err.message : err) };
        }
    }, [evmSigner]);
    const setEvmEnforcedOptions = useCallback(async (contractAddr, peerEid, gas) => {
        if (!evmSigner)
            return { status: 'error', message: 'Wallet not connected' };
        const opts = buildLzReceiveOption(gas);
        const param = { eid: peerEid, msgType: SEND_MSG_TYPE, options: opts };
        try {
            const c = adapterContract(contractAddr, evmSigner);
            const tx = await c.setEnforcedOptions([param]);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: String(err instanceof Error ? err.message : err) };
        }
    }, [evmSigner]);
    const setRateLimit = useCallback(async (adapterAddr, dstEid, limit, window) => {
        if (!evmSigner)
            return { status: 'error', message: 'Wallet not connected' };
        try {
            const c = adapterContract(adapterAddr, evmSigner);
            const tx = await c.setRateLimits([{ dstEid, limit, window }]);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: String(err instanceof Error ? err.message : err) };
        }
    }, [evmSigner]);
    const setDelegate = useCallback(async (contractAddr, delegate) => {
        if (!evmSigner)
            return { status: 'error', message: 'Wallet not connected' };
        try {
            const c = adapterContract(contractAddr, evmSigner);
            const tx = await c.setDelegate(delegate);
            await tx.wait();
            return { status: 'success', hash: tx.hash };
        }
        catch (err) {
            return { status: 'error', message: String(err instanceof Error ? err.message : err) };
        }
    }, [evmSigner]);
    // ── Cairo side (scaffold) ─────────────────────────────────────────────────
    const setCairoPeer = useCallback(async (_cairoOftAddr, _adapterEid, _adapterEvmAddr) => {
        // TODO: implement when Cairo OFT ABI is available.
        // Expected:
        //   const contract = new StarkContract(CairoOFTPeerABI, cairoOftAddr, starkAccount);
        //   await contract.invoke('set_peer', [adapterEid, { low: evmToFelt(adapterEvmAddr).toString(), high: '0' }]);
        return { status: 'error', message: 'Cairo wiring not yet implemented — contracts pending' };
    }, []);
    return {
        readTokenInfo,
        readEvmSideInfo,
        readAdapterState,
        readPeerState,
        readAllPeers,
        setEvmPeer,
        setEvmPeerToCairo,
        setEvmEnforcedOptions,
        setRateLimit,
        setDelegate,
        setCairoPeer,
    };
}
