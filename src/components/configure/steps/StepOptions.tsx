import { useState } from 'react';
import { TxStatus } from '@/components/TxStatus';
import type { TxState } from '@/types';
import type { StepProps } from '../types';
import { explorerTxUrl } from '../types';
import { NetworkHint } from './StepDelegate';

export function StepOptions({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const [gas, setGas] = useState('80000');
  const [homeTx, setHomeTx] = useState<TxState>({ status: 'idle' });
  const [remoteTx, setRemoteTx] = useState<TxState>({ status: 'idle' });

  async function handleHome(): Promise<void> {
    setHomeTx({ status: 'pending' });
    let result: TxState;
    if (home.kind === 'starknet') {
      result = await hooks.cairoEndpoint.setEnforcedOptions(home.contractAddr, remote.chain.eid, BigInt(gas), home.starkChain!.rpc);
    } else {
      result = await hooks.wiring.setEvmEnforcedOptions(home.contractAddr, remote.chain.eid, BigInt(gas));
    }
    setHomeTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  async function handleRemote(): Promise<void> {
    setRemoteTx({ status: 'pending' });
    let result: TxState;
    if (remote.kind === 'starknet') {
      result = await hooks.cairoEndpoint.setEnforcedOptions(remote.contractAddr, home.chain.eid, BigInt(gas), remote.starkChain!.rpc);
    } else {
      result = await hooks.wiring.setEvmEnforcedOptions(remote.contractAddr, home.chain.eid, BigInt(gas));
    }
    setRemoteTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  return (
    <div>
      <p className="step-hint">
        Enforced options set the minimum gas for lzReceive. Must be configured on both sides before opening peers.
      </p>

      <div className="mb-3">
        <div className="label">Gas limit for lzReceive</div>
        <input className="input" style={{ maxWidth: 200 }} value={gas} onChange={(e) => setGas(e.target.value)} placeholder="80000" />
      </div>

      <div className="step-actions">
        {/* Home side */}
        <div>
          <div className="label mb-1">Home — {home.chainLabel}</div>
          {verifyResult?.homeEnforcedOptions && verifyResult.homeEnforcedOptions !== '0x' && (
            <div className="text-xs text-[var(--text-muted)] mb-2">
              Current: <span className="font-mono text-[11px]">set ✓</span>
            </div>
          )}
          <NetworkHint side={home} />
          <button className="btn btn-primary" disabled={!home.isConnected || home.needsNetworkSwitch}
            onClick={handleHome}>Set on {home.chainLabel}</button>
          <div className="mt-1.5"><TxStatus state={homeTx} explorerUrl={explorerTxUrl(home)} /></div>
        </div>

        {/* Remote side */}
        <div>
          <div className="label mb-1">Remote — {remote.chainLabel}</div>
          {verifyResult?.remoteEnforcedOptions && verifyResult.remoteEnforcedOptions !== '0x' && (
            <div className="text-xs text-[var(--text-muted)] mb-2">
              Current: <span className="font-mono text-[11px]">set ✓</span>
            </div>
          )}
          <NetworkHint side={remote} />
          <button className="btn btn-primary" disabled={!remote.isConnected || remote.needsNetworkSwitch}
            onClick={handleRemote}>Set on {remote.chainLabel}</button>
          <div className="mt-1.5"><TxStatus state={remoteTx} explorerUrl={explorerTxUrl(remote)} /></div>
        </div>
      </div>
    </div>
  );
}
