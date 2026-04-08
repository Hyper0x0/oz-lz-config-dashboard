import { useState } from 'react';
import { TxStatus } from '@/components/TxStatus';
import type { TxState } from '@/types';
import type { StepProps } from '../types';
import { explorerTxUrl } from '../types';
import { NetworkHint } from './StepDelegate';

export function StepRateLimit({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const homeDefaults = home.evmChain?.defaults ?? home.starkChain?.defaults;
  const defaultWindow = String(homeDefaults?.rateLimitWindow ?? 3600);
  const [limit, setLimit] = useState('1000000000000000000000000');
  const [window_, setWindow] = useState(defaultWindow);
  const [tx, setTx] = useState<TxState>({ status: 'idle' });

  const rl = verifyResult?.homeRateLimit;

  async function handleSet(): Promise<void> {
    setTx({ status: 'pending' });
    const result = await hooks.wiring.setRateLimit(home.contractAddr, remote.chain.eid, BigInt(limit), Number(window_));
    setTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  return (
    <div>
      <p className="step-hint">
        Rate limits cap how much can be bridged per time window. Set limit to 0 to disable.
        Applies to the adapter on the home chain only.
      </p>

      {rl && (
        <div className="text-xs text-[var(--text-muted)] mb-3">
          Current: {rl.limit.toString()} per {rl.window}s
        </div>
      )}

      <div className="form-grid mb-3">
        <div>
          <div className="label">Limit (raw token units)</div>
          <input className="input" value={limit} onChange={(e) => setLimit(e.target.value)} />
          <div className="text-[11px] text-[var(--text-muted)] mt-1">Depends on token supply & decimals</div>
        </div>
        <div>
          <div className="label">Window (seconds)</div>
          <input className="input" value={window_} onChange={(e) => setWindow(e.target.value)} placeholder={defaultWindow} />
          <div className="text-[11px] text-[var(--text-muted)] mt-1">
            Recommended: {homeDefaults?.rateLimitWindow ?? 3600}s ({(homeDefaults?.rateLimitWindow ?? 3600) <= 60 ? '1 min' : '1 hour'})
          </div>
        </div>
      </div>

      <NetworkHint side={home} />
      <button className="btn btn-primary" disabled={!home.isConnected || home.needsNetworkSwitch}
        onClick={handleSet}>Set Rate Limit</button>
      <div className="mt-1.5"><TxStatus state={tx} explorerUrl={explorerTxUrl(home)} /></div>
    </div>
  );
}
