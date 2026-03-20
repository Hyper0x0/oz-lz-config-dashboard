import { useState, useCallback } from 'react';
import { BrowserProvider, JsonRpcSigner } from 'ethers';

interface EvmWallet {
  signer: JsonRpcSigner | null;
  provider: BrowserProvider | null;
  address: string | null;
  chainId: number | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  switchNetwork: (chainId: number) => Promise<void>;
}

export function useEvmWallet(): EvmWallet {
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [browserProvider, setBrowserProvider] = useState<BrowserProvider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const connect = useCallback(async (): Promise<void> => {
    const eth = window.ethereum;
    if (!eth) throw new Error('No EVM wallet detected');
    const provider = new BrowserProvider(eth);
    await provider.send('eth_requestAccounts', []);
    const s = await provider.getSigner();
    const network = await provider.getNetwork();
    setSigner(s);
    setBrowserProvider(provider);
    setAddress(await s.getAddress());
    setChainId(Number(network.chainId));
  }, []);

  const switchNetwork = useCallback(async (targetChainId: number): Promise<void> => {
    const eth = window.ethereum;
    if (!eth) throw new Error('No EVM wallet detected');
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
