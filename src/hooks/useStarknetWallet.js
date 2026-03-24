import { useState, useCallback } from 'react';
import { connect, disconnect } from 'starknetkit';
import { WalletAccount, RpcProvider } from 'starknet';
import { STARKNET_TESTNET } from '@/config/chains';
export function useStarknetWallet() {
    const [account, setAccount] = useState(null);
    const [address, setAddress] = useState(null);
    const [chainId, setChainId] = useState(null);
    const connectWallet = useCallback(async () => {
        const { connector, connectorData, wallet } = await connect({ modalMode: 'alwaysAsk' });
        if (!connector || !connectorData?.account || !wallet)
            return;
        const provider = new RpcProvider({ nodeUrl: STARKNET_TESTNET.rpc });
        const acc = await WalletAccount.connect(provider, wallet);
        setAccount(acc);
        setAddress(connectorData.account);
        setChainId(connectorData.chainId ? String(connectorData.chainId) : null);
    }, []);
    const disconnectWallet = useCallback(async () => {
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
