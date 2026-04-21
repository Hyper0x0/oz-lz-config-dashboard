import { useState, useCallback, useEffect } from 'react';
import { connect, disconnect } from 'starknetkit';
import { WalletAccount, RpcProvider } from 'starknet';
import { STARKNET_MAINNET, STARKNET_TESTNET } from '@/config/chains';
import { getStarknetMainnetRpc, getStarknetSepoliaRpc } from '@/pages/Settings';

export interface StarknetWallet {
  account: WalletAccount | null;
  address: string | null;
  chainId: string | null;
  isConnected: boolean;
  connect: (rpc?: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

const SN_SEPOLIA_CHAIN_ID = BigInt('0x534e5f5345504f4c4941');

function resolveRpc(chainId: bigint | undefined, rpc?: string): string {
  if (rpc) return rpc;
  const isSepolia = chainId !== undefined && chainId === SN_SEPOLIA_CHAIN_ID;
  return isSepolia
    ? getStarknetSepoliaRpc(STARKNET_TESTNET.rpc)
    : getStarknetMainnetRpc(STARKNET_MAINNET.rpc);
}

export function useStarknetWallet(): StarknetWallet {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);

  // Auto-reconnect: try silent reconnect from starknetkit session
  useEffect(() => {
    (async () => {
      try {
        const { connector, connectorData, wallet } = await connect({ modalMode: 'neverAsk' });
        if (!connector || !connectorData?.account || !wallet) return;
        const resolvedRpc = resolveRpc(connectorData.chainId);
        const provider = new RpcProvider({ nodeUrl: resolvedRpc });
        const acc = await WalletAccount.connect(provider, wallet);
        setAccount(acc);
        setAddress(connectorData.account);
        setChainId(connectorData.chainId !== undefined ? connectorData.chainId.toString() : null);
      } catch { /* no previous session */ }
    })();
  }, []);

  const connectWallet = useCallback(async (rpc?: string): Promise<void> => {
    const { connector, connectorData, wallet } = await connect({ modalMode: 'alwaysAsk' });
    if (!connector || !connectorData?.account || !wallet) return;

    const resolvedRpc = resolveRpc(connectorData.chainId, rpc);
    const provider = new RpcProvider({ nodeUrl: resolvedRpc });
    const acc = await WalletAccount.connect(provider, wallet);

    setAccount(acc);
    setAddress(connectorData.account);
    setChainId(connectorData.chainId !== undefined ? connectorData.chainId.toString() : null);
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
