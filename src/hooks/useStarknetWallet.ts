import { useState, useCallback } from 'react';
import { connect, disconnect } from 'starknetkit';
import { WalletAccount, RpcProvider } from 'starknet';
import { STARKNET_TESTNET } from '@/config/chains';

export interface StarknetWallet {
  account: WalletAccount | null;
  address: string | null;
  chainId: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useStarknetWallet(): StarknetWallet {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);

  const connectWallet = useCallback(async (): Promise<void> => {
    const { connector, connectorData, wallet } = await connect({ modalMode: 'alwaysAsk' });
    if (!connector || !connectorData?.account || !wallet) return;

    const provider = new RpcProvider({ nodeUrl: STARKNET_TESTNET.rpc });
    const acc = await WalletAccount.connect(provider, wallet);

    setAccount(acc);
    setAddress(connectorData.account);
    setChainId(connectorData.chainId ? String(connectorData.chainId) : null);
  }, []);

  const disconnectWallet = useCallback(async (): Promise<void> => {
    await disconnect();
    setAccount(null);
    setAddress(null);
    setChainId(null);
  }, []);

  return {
    account,
    address,
    chainId,
    isConnected: !!account,
    connect: connectWallet,
    disconnect: disconnectWallet,
  };
}
