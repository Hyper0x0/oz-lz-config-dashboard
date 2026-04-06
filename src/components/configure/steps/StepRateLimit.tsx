import { useState } from 'react';
import { TxStatus } from '@/components/TxStatus';
import type { TxState } from '@/types';
import type { StepProps } from '../types';
import { NetworkHint } from './StepDelegate';

export function StepRateLimit({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const [limit, setLimit] = useState('1000000000000000000000000');
  const [window_, setWindow] = useState('3600');
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
        </div>
        <div>
          <div className="label">Window (seconds)</div>
          <input className="input" value={window_} onChange={(e) => setWindow(e.target.value)} placeholder="3600" />
        </div>
      </div>

      <NetworkHint side={home} />
      <button className="btn btn-primary" disabled={!home.isConnected || home.needsNetworkSwitch}
        onClick={handleSet}>Set Rate Limit</button>
      <div className="mt-1.5"><TxStatus state={tx} /></div>
    </div>
  );
}
