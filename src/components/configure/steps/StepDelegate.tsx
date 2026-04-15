import { useState } from 'react';
import { TxStatus } from '@/components/TxStatus';
import { WalletChainHint } from '@/components/ChainSwitch';
import { isStarknet } from '@/config/lzCatalog';
import type { TxState } from '@/types';
import type { StepProps } from '../types';
import { explorerTxUrl } from '../types';

export function StepDelegate({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const [homeDelegate, setHomeDelegate] = useState('');
  const [remoteDelegate, setRemoteDelegate] = useState('');
  const [homeTx, setHomeTx] = useState<TxState>({ status: 'idle' });
  const [remoteTx, setRemoteTx] = useState<TxState>({ status: 'idle' });

  const homeIsStark = home.kind === 'starknet';
  const remoteIsStark = remote.kind === 'starknet';

  async function handleHome(): Promise<void> {
    setHomeTx({ status: 'pending' });
    let result: TxState;
    if (homeIsStark) {
      result = await hooks.cairoEndpoint.setDelegate(home.contractAddr, homeDelegate, home.starkChain!.rpc);
    } else {
      result = await hooks.wiring.setDelegate(home.contractAddr, homeDelegate);
    }
    setHomeTx(result);
    if (result.status === 'success') onTxSuccess('home');
  }

  async function handleRemote(): Promise<void> {
    setRemoteTx({ status: 'pending' });
    let result: TxState;
    if (remoteIsStark) {
      result = await hooks.cairoEndpoint.setDelegate(remote.contractAddr, remoteDelegate, remote.starkChain!.rpc);
    } else {
      result = await hooks.wiring.setDelegate(remote.contractAddr, remoteDelegate);
    }
    setRemoteTx(result);
    if (result.status === 'success') onTxSuccess('remote');
  }

  return (
    <div>
      <p className="step-hint">
        The delegate can configure the endpoint (libraries, DVNs, executor) without being the OFT owner.
        {homeIsStark || remoteIsStark ? ' Required on Starknet before any endpoint configuration.' : ' Optional but recommended.'}
      </p>

      <div className="step-actions">
        {/* Source side */}
        <div>
          <div className="label mb-1">Source — {home.chainLabel}</div>
          {verifyResult?.homeDelegate && (
            <div className="text-xs text-[var(--text-muted)] mb-2">
              Current: <span className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>{verifyResult.homeDelegate}</span>
            </div>
          )}
          <input className="input mb-2" value={homeDelegate} onChange={(e) => setHomeDelegate(e.target.value)}
            placeholder="0x…" spellCheck={false} />
          <NetworkHint side={home} />
          <button className="btn btn-primary" disabled={!home.isConnected || home.needsNetworkSwitch || !homeDelegate}
            onClick={handleHome}>Set Delegate</button>
          <div className="mt-1.5"><TxStatus state={homeTx} explorerUrl={explorerTxUrl(home)} /></div>
        </div>

        {/* Destination side */}
        <div>
          <div className="label mb-1">Destination — {remote.chainLabel}</div>
          {verifyResult?.remoteDelegate && (
            <div className="text-xs text-[var(--text-muted)] mb-2">
              Current: <span className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>{verifyResult.remoteDelegate}</span>
            </div>
          )}
          <input className="input mb-2" value={remoteDelegate} onChange={(e) => setRemoteDelegate(e.target.value)}
            placeholder="0x…" spellCheck={false} />
          <NetworkHint side={remote} />
          <button className="btn btn-primary" disabled={!remote.isConnected || remote.needsNetworkSwitch || !remoteDelegate}
            onClick={handleRemote}>Set Delegate</button>
          <div className="mt-1.5"><TxStatus state={remoteTx} explorerUrl={explorerTxUrl(remote)} /></div>
        </div>
      </div>
    </div>
  );
}

/** Shows network switch button or connected indicator */
export function NetworkHint({ side }: { side: { kind: string; isConnected: boolean; needsNetworkSwitch: boolean; chainLabel: string; switchNetwork: () => void } }): JSX.Element {
  if (!side.isConnected) {
    return <div className="text-xs mb-1.5 text-on-surface-variant">{side.kind === 'starknet' ? 'Connect Starknet wallet' : 'Connect EVM wallet'}</div>;
  }
  return (
    <div className="mb-1.5">
      <WalletChainHint
        isConnected={side.isConnected}
        isCorrectChain={!side.needsNetworkSwitch}
        chainName={side.chainLabel}
        onSwitch={side.switchNetwork}
        variant={side.kind === 'starknet' ? 'starknet' : 'evm'}
      />
    </div>
  );
}
