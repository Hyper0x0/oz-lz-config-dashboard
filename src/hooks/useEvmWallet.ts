import { useState, useCallback, useEffect, useRef } from 'react';
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
  const listenersAttached = useRef(false);

  /** Shared helper: build provider/signer from window.ethereum and update state. */
  const syncWallet = useCallback(async (): Promise<void> => {
    const eth = window.ethereum;
    if (!eth) return;
    const provider = new BrowserProvider(eth);
    const accounts: string[] = await provider.send('eth_accounts', []);
    if (accounts.length === 0) {
      setSigner(null);
      setBrowserProvider(null);
      setAddress(null);
      setChainId(null);
      return;
    }
    const s = await provider.getSigner();
    const network = await provider.getNetwork();
    setSigner(s);
    setBrowserProvider(provider);
    setAddress(await s.getAddress());
    setChainId(Number(network.chainId));
  }, []);

  // Auto-reconnect on mount (silent — no popup if already authorised)
  useEffect(() => {
    syncWallet().catch(() => {});
  }, [syncWallet]);

  // Listen for MetaMask account/chain changes
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth || listenersAttached.current) return;
    listenersAttached.current = true;

    const onAccountsChanged = () => { syncWallet().catch(() => {}); };
    const onChainChanged = () => { syncWallet().catch(() => {}); };

    eth.on('accountsChanged', onAccountsChanged);
    eth.on('chainChanged', onChainChanged);

    return () => {
      eth.removeListener('accountsChanged', onAccountsChanged);
      eth.removeListener('chainChanged', onChainChanged);
      listenersAttached.current = false;
    };
  }, [syncWallet]);

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
    // syncWallet will fire via chainChanged listener, but call explicitly for immediate feedback
    await syncWallet();
  }, [syncWallet]);

  return { signer, provider: browserProvider, address, chainId, isConnected: signer !== null, connect, switchNetwork };
}
