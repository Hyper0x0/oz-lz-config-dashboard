/**
 * TODO: implement when Cairo OFT contracts are deployed.
 *
 * Expected implementation (starknetkit v2 + starknet.js v6):
 *
 *   import { connect } from 'starknetkit';
 *   import { WalletAccount, RpcProvider } from 'starknet';
 *
 *   const { wallet } = await connect({ modalMode: 'alwaysAsk' });
 *   const provider = new RpcProvider({ nodeUrl: VITE_STARKNET_RPC });
 *   const account = new WalletAccount(provider, wallet);
 *
 * Verify exact API against the installed starknetkit version before wiring.
 */

import { useState, useCallback } from 'react';

interface StarknetWallet {
  // WalletAccount from starknet.js — typed as unknown until Cairo contracts are ready
  account: unknown;
  address: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
}

export function useStarknetWallet(): StarknetWallet {
  const [account] = useState<unknown>(null);
  const [address] = useState<string | null>(null);

  const connect = useCallback(async (): Promise<void> => {
    // TODO: implement starknetkit connect
    throw new Error('Starknet wallet not yet implemented — Cairo contracts pending');
  }, []);

  return { account, address, isConnected: false, connect };
}
