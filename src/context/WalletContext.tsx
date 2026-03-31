import { createContext, useContext, ReactNode } from 'react';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';

type EvmWallet = ReturnType<typeof useEvmWallet>;
type StarknetWallet = ReturnType<typeof useStarknetWallet>;

interface WalletCtx { evm: EvmWallet; stark: StarknetWallet; }
const WalletContext = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }): JSX.Element {
  const evm = useEvmWallet();
  const stark = useStarknetWallet();
  return <WalletContext.Provider value={{ evm, stark }}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletCtx {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider');
  return ctx;
}
