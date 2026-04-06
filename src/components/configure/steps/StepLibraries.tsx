import { useState, useEffect } from 'react';
import { TxStatus } from '@/components/TxStatus';
import { useEndpointConfig } from '@/hooks/useEndpointConfig';
import type { TxState } from '@/types';
import type { LZChain, StarknetChain } from '@/config/lzCatalog';
import type { StepProps } from '../types';
import { NetworkHint } from './StepDelegate';

export function StepLibraries({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const epConfig = useEndpointConfig(hooks.evm.signer);

  // Pre-fill from verify result or chain catalog
  const defaultSendLib = verifyResult?.homeSendLib ?? home.evmChain?.sendLib ?? home.starkChain?.sendLib ?? '';
  const defaultRecvLib = verifyResult?.remoteReceiveLib ?? remote.evmChain?.receiveLib ?? remote.starkChain?.receiveLib ?? '';

  const [sendLib, setSendLib] = useState(defaultSendLib);
  const [recvLib, setRecvLib] = useState(defaultRecvLib);
  const [gracePeriod, setGracePeriod] = useState('0');
  const [sendTx, setSendTx] = useState<TxState>({ status: 'idle' });
  const [recvTx, setRecvTx] = useState<TxState>({ status: 'idle' });

  // Sync defaults when verify result loads
  useEffect(() => { if (!sendLib && defaultSendLib) setSendLib(defaultSendLib); }, [defaultSendLib]); // eslint-disable-line
  useEffect(() => { if (!recvLib && defaultRecvLib) setRecvLib(defaultRecvLib); }, [defaultRecvLib]); // eslint-disable-line

  // ── Home side: Set Send Library ───────────────────────────────────────────
  async function handleSend(): Promise<void> {
    setSendTx({ status: 'pending' });
    let result: TxState;
    if (home.kind === 'starknet') {
      // Starknet: set both send + receive in one tx (same contract address)
      result = await hooks.cairoEndpoint.setLibraries(
        home.starkChain!.endpoint, home.contractAddr, remote.chain.eid,
        sendLib, Number(gracePeriod), home.starkChain!.rpc,
      );
    } else {
      result = await epConfig.setSendLib(home.evmChain!.endpoint, home.contractAddr, remote.chain.eid, sendLib);
    }
    setSendTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  // ── Remote side: Set Receive Library ──────────────────────────────────────
  async function handleRecv(): Promise<void> {
    setRecvTx({ status: 'pending' });
    let result: TxState;
    if (remote.kind === 'starknet') {
      result = await hooks.cairoEndpoint.setLibraries(
        remote.starkChain!.endpoint, remote.contractAddr, home.chain.eid,
        recvLib, Number(gracePeriod), remote.starkChain!.rpc,
      );
    } else {
      result = await epConfig.setReceiveLib(remote.evmChain!.endpoint, remote.contractAddr, home.chain.eid, recvLib);
    }
    setRecvTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  const homeIsStark = home.kind === 'starknet';
  const remoteIsStark = remote.kind === 'starknet';

  return (
    <div>
      {home.evmChain?.isTestnet && (
        <div className="step-info mb-3">
          <span style={{ color: 'var(--secondary)' }}>✓ Testnet</span> — default libraries are assigned automatically.
        </div>
      )}

      <div className="step-actions">
        {/* Home: Send Library */}
        <div>
          <div className="label mb-1">
            {homeIsStark ? 'Send & Receive Library' : 'Send Library'} — {home.chainLabel}
          </div>
          {homeIsStark && (
            <p className="text-[11px] text-[var(--text-muted)] mb-2">
              On Starknet, send and receive use the same library address.
            </p>
          )}
          {verifyResult?.homeSendLib && (
            <div className="text-xs text-[var(--text-muted)] mb-1">
              Current: <span className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>{verifyResult.homeSendLib}</span>
            </div>
          )}
          <input className="input mb-2" value={sendLib} onChange={(e) => setSendLib(e.target.value)}
            placeholder="0x…" spellCheck={false} />
          {homeIsStark && (
            <div className="mb-2">
              <div className="label">Grace period (blocks, 0 = immediate)</div>
              <input className="input" style={{ width: 120 }} value={gracePeriod}
                onChange={(e) => setGracePeriod(e.target.value)} />
            </div>
          )}
          <NetworkHint side={home} />
          <button className="btn btn-primary" disabled={!home.isConnected || home.needsNetworkSwitch || !sendLib}
            onClick={handleSend}>
            {homeIsStark ? 'Set Send & Receive Library' : 'Set Send Library'}
          </button>
          <div className="mt-1.5"><TxStatus state={sendTx} /></div>
        </div>

        {/* Remote: Receive Library (hidden if home is Starknet and remote is also handled above) */}
        <div>
          <div className="label mb-1">
            {remoteIsStark ? 'Send & Receive Library' : 'Receive Library'} — {remote.chainLabel}
          </div>
          {remoteIsStark && (
            <p className="text-[11px] text-[var(--text-muted)] mb-2">
              On Starknet, send and receive use the same library address.
            </p>
          )}
          {verifyResult?.remoteReceiveLib && (
            <div className="text-xs text-[var(--text-muted)] mb-1">
              Current: <span className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>
                {verifyResult.remoteReceiveLib}
                {verifyResult.remoteReceiveLibIsDefault ? ' (default)' : ''}
              </span>
            </div>
          )}
          <input className="input mb-2" value={recvLib} onChange={(e) => setRecvLib(e.target.value)}
            placeholder="0x…" spellCheck={false} />
          {remoteIsStark && (
            <div className="mb-2">
              <div className="label">Grace period (blocks, 0 = immediate)</div>
              <input className="input" style={{ width: 120 }} value={gracePeriod}
                onChange={(e) => setGracePeriod(e.target.value)} />
            </div>
          )}
          <NetworkHint side={remote} />
          <button className="btn btn-primary" disabled={!remote.isConnected || remote.needsNetworkSwitch || !recvLib}
            onClick={handleRecv}>
            {remoteIsStark ? 'Set Send & Receive Library' : 'Set Receive Library'}
          </button>
          <div className="mt-1.5"><TxStatus state={recvTx} /></div>
        </div>
      </div>
    </div>
  );
}
