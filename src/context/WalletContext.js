import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext } from 'react';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
const WalletContext = createContext(null);
export function WalletProvider({ children }) {
    const evm = useEvmWallet();
    const stark = useStarknetWallet();
    return _jsx(WalletContext.Provider, { value: { evm, stark }, children: children });
}
export function useWallet() {
    const ctx = useContext(WalletContext);
    if (!ctx)
        throw new Error('useWallet must be used inside WalletProvider');
    return ctx;
}
