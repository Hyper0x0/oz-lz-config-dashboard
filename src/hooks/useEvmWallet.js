import { useState, useCallback } from 'react';
import { BrowserProvider } from 'ethers';
export function useEvmWallet() {
    const [signer, setSigner] = useState(null);
    const [browserProvider, setBrowserProvider] = useState(null);
    const [address, setAddress] = useState(null);
    const [chainId, setChainId] = useState(null);
    const connect = useCallback(async () => {
        const eth = window.ethereum;
        if (!eth)
            throw new Error('No EVM wallet detected');
        const provider = new BrowserProvider(eth);
        await provider.send('eth_requestAccounts', []);
        const s = await provider.getSigner();
        const network = await provider.getNetwork();
        setSigner(s);
        setBrowserProvider(provider);
        setAddress(await s.getAddress());
        setChainId(Number(network.chainId));
    }, []);
    const switchNetwork = useCallback(async (targetChainId) => {
        const eth = window.ethereum;
        if (!eth)
            throw new Error('No EVM wallet detected');
        const chainIdHex = '0x' + targetChainId.toString(16);
        await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainIdHex }],
        });
        // Re-init signer after network switch
        const provider = new BrowserProvider(eth);
        const s = await provider.getSigner();
        const network = await provider.getNetwork();
        setSigner(s);
        setBrowserProvider(provider);
        setAddress(await s.getAddress());
        setChainId(Number(network.chainId));
    }, []);
    return { signer, provider: browserProvider, address, chainId, isConnected: signer !== null, connect, switchNetwork };
}
