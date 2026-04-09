import { useState } from 'react';
import { TxStatus } from '@/components/TxStatus';
import type { TxState } from '@/types';
import type { StepProps } from '../types';
import { explorerTxUrl } from '../types';
import { NetworkHint } from './StepDelegate';

export function StepOptions({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const homeDefaults = home.evmChain?.defaults ?? home.starkChain?.defaults;
  const remoteDefaults = remote.evmChain?.defaults ?? remote.starkChain?.defaults;
  const [homeGas, setHomeGas] = useState(String(homeDefaults?.gasLimit ?? 80000));
  const [remoteGas, setRemoteGas] = useState(String(remoteDefaults?.gasLimit ?? 80000));
  const [homeTx, setHomeTx] = useState<TxState>({ status: 'idle' });
  const [remoteTx, setRemoteTx] = useState<TxState>({ status: 'idle' });

  async function handleHome(): Promise<void> {
    setHomeTx({ status: 'pending' });
    let result: TxState;
    if (home.kind === 'starknet') {
      result = await hooks.cairoEndpoint.setEnforcedOptions(home.contractAddr, remote.chain.eid, BigInt(homeGas), home.starkChain!.rpc);
    } else {
      result = await hooks.wiring.setEvmEnforcedOptions(home.contractAddr, remote.chain.eid, BigInt(homeGas));
    }
    setHomeTx(result);
    if (result.status === 'success') onTxSuccess('home');
  }

  async function handleRemote(): Promise<void> {
    setRemoteTx({ status: 'pending' });
    let result: TxState;
    if (remote.kind === 'starknet') {
      result = await hooks.cairoEndpoint.setEnforcedOptions(remote.contractAddr, home.chain.eid, BigInt(remoteGas), remote.starkChain!.rpc);
    } else {
      result = await hooks.wiring.setEvmEnforcedOptions(remote.contractAddr, home.chain.eid, BigInt(remoteGas));
    }
    setRemoteTx(result);
    if (result.status === 'success') onTxSuccess('remote');
  }

  return (
    <div>
      <p className="step-hint">
        Enforced options set the minimum gas for lzReceive. Must be configured on both sides before opening peers.
      </p>

      <div className="step-actions" style={{ alignItems: 'start' }}>
        {/* Home chain */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary mb-3">
            {home.chainLabel}
          </div>
          <div className="label">Gas limit for lzReceive</div>
          <input className="input mb-1" style={{ maxWidth: 200 }} value={homeGas} onChange={(e) => setHomeGas(e.target.value)}
            placeholder={String(homeDefaults?.gasLimit ?? 80000)} />
          <div className="text-[11px] text-[var(--text-muted)] mb-2">
            Recommended: {homeDefaults?.gasLimit ?? '—'}
          </div>
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

        {/* Remote chain */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary mb-3">
            {remote.chainLabel}
          </div>
          <div className="label">Gas limit for lzReceive</div>
          <input className="input mb-1" style={{ maxWidth: 200 }} value={remoteGas} onChange={(e) => setRemoteGas(e.target.value)}
            placeholder={String(remoteDefaults?.gasLimit ?? 80000)} />
          <div className="text-[11px] text-[var(--text-muted)] mb-2">
            Recommended: {remoteDefaults?.gasLimit ?? '—'}
          </div>
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
