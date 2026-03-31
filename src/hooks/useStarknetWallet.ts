import { useState, useCallback } from 'react';
import { connect, disconnect } from 'starknetkit';
import { WalletAccount, RpcProvider } from 'starknet';
import { STARKNET_MAINNET, STARKNET_TESTNET } from '@/config/chains';

export interface StarknetWallet {
  account: WalletAccount | null;
  address: string | null;
  chainId: string | null;
  isConnected: boolean;
  connect: (rpc?: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useStarknetWallet(): StarknetWallet {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);

  const connectWallet = useCallback(async (rpc?: string): Promise<void> => {
    const { connector, connectorData, wallet } = await connect({ modalMode: 'alwaysAsk' });
    if (!connector || !connectorData?.account || !wallet) return;

    // Prefer the caller-provided RPC, then detect from chainId reported by wallet,
    // fall back to mainnet. starknetkit reports chainId as bigint or undefined.
    // Starknet Sepolia chainId = 0x534e5f5345504f4c4941 (felt encoding of "SN_SEPOLIA")
    const SN_SEPOLIA_CHAIN_ID = BigInt('0x534e5f5345504f4c4941');
    const isSepolia = connectorData.chainId !== undefined && connectorData.chainId === SN_SEPOLIA_CHAIN_ID;
    const resolvedRpc = rpc ?? (isSepolia ? STARKNET_TESTNET.rpc : STARKNET_MAINNET.rpc);
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
