import { useState, useEffect } from 'react';
import { TxStatus } from '@/components/TxStatus';
import { useEndpointConfig } from '@/hooks/useEndpointConfig';
import type { TxState } from '@/types';
import type { StepProps } from '../types';
import { explorerTxUrl } from '../types';
import { NetworkHint } from './StepDelegate';

/**
 * Bidirectional library configuration.
 * A→B: home send lib + remote receive lib
 * B→A: remote send lib + home receive lib
 */
export function StepLibraries({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const epConfig = useEndpointConfig(hooks.evm.signer);
  const [direction, setDirection] = useState<'AtoB' | 'BtoA'>('AtoB');

  // A→B: home sends, remote receives
  const abSendDefault = verifyResult?.homeSendLib ?? home.evmChain?.sendLib ?? home.starkChain?.sendLib ?? '';
  const abRecvDefault = verifyResult?.remoteReceiveLib ?? remote.evmChain?.receiveLib ?? remote.starkChain?.receiveLib ?? '';
  const [abSendLib, setAbSendLib] = useState(abSendDefault);
  const [abRecvLib, setAbRecvLib] = useState(abRecvDefault);
  const [abSendTx, setAbSendTx] = useState<TxState>({ status: 'idle' });
  const [abRecvTx, setAbRecvTx] = useState<TxState>({ status: 'idle' });

  // B→A: remote sends, home receives
  const baSendDefault = verifyResult?.remoteSendLib ?? remote.evmChain?.sendLib ?? remote.starkChain?.sendLib ?? '';
  const baRecvDefault = verifyResult?.homeReceiveLib ?? home.evmChain?.receiveLib ?? home.starkChain?.receiveLib ?? '';
  const [baSendLib, setBaSendLib] = useState(baSendDefault);
  const [baRecvLib, setBaRecvLib] = useState(baRecvDefault);
  const [baSendTx, setBaSendTx] = useState<TxState>({ status: 'idle' });
  const [baRecvTx, setBaRecvTx] = useState<TxState>({ status: 'idle' });

  const [gracePeriod, setGracePeriod] = useState('0');

  // Sync defaults
  useEffect(() => { if (!abSendLib && abSendDefault) setAbSendLib(abSendDefault); }, [abSendDefault]); // eslint-disable-line
  useEffect(() => { if (!abRecvLib && abRecvDefault) setAbRecvLib(abRecvDefault); }, [abRecvDefault]); // eslint-disable-line
  useEffect(() => { if (!baSendLib && baSendDefault) setBaSendLib(baSendDefault); }, [baSendDefault]); // eslint-disable-line
  useEffect(() => { if (!baRecvLib && baRecvDefault) setBaRecvLib(baRecvDefault); }, [baRecvDefault]); // eslint-disable-line

  // Generic set handler
  async function handleSetLib(
    side: typeof home,
    lib: string,
    remoteEid: number,
    isSend: boolean,
    setTx: (s: TxState) => void,
  ): Promise<void> {
    setTx({ status: 'pending' });
    let result: TxState;
    if (side.kind === 'starknet') {
      // Starknet: set both send + receive in one tx
      result = await hooks.cairoEndpoint.setLibraries(
        side.starkChain!.endpoint, side.contractAddr, remoteEid,
        lib, Number(gracePeriod), side.starkChain!.rpc,
      );
    } else if (isSend) {
      result = await epConfig.setSendLib(side.evmChain!.endpoint, side.contractAddr, remoteEid, lib);
    } else {
      result = await epConfig.setReceiveLib(side.evmChain!.endpoint, side.contractAddr, remoteEid, lib);
    }
    setTx(result);
    if (result.status === 'success') onTxSuccess(side === home ? 'home' : 'remote');
  }

  function renderSide(
    label: string, side: typeof home, lib: string, setLib: (v: string) => void,
    currentLib: string | null | undefined, isDefault: boolean | undefined,
    isSend: boolean, tx: TxState, setTx: (s: TxState) => void, remoteEid: number,
  ): JSX.Element {
    const isStark = side.kind === 'starknet';
    return (
      <div>
        <div className="label mb-1">
          {isStark ? 'Send & Receive Library' : label} — {side.chainLabel}
        </div>
        {isStark && (
          <p className="text-[11px] text-[var(--text-muted)] mb-2">
            On Starknet, send and receive use the same library address.
          </p>
        )}
        {currentLib && (
          <div className="text-xs text-[var(--text-muted)] mb-1">
            Current: <span className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>
              {currentLib}{isDefault ? ' (default)' : ''}
            </span>
          </div>
        )}
        <input className="input mb-2" value={lib} onChange={(e) => setLib(e.target.value)}
          placeholder="0x…" spellCheck={false} />
        {isStark && (
          <div className="mb-2">
            <div className="label">Grace period (blocks, 0 = immediate)</div>
            <input className="input" style={{ width: 120 }} value={gracePeriod}
              onChange={(e) => setGracePeriod(e.target.value)} />
          </div>
        )}
        <NetworkHint side={side} />
        <button className="btn btn-primary" disabled={!side.isConnected || side.needsNetworkSwitch || !lib}
          onClick={() => handleSetLib(side, lib, remoteEid, isSend, setTx)}>
          {isStark ? 'Set Send & Receive Library' : `Set ${label}`}
        </button>
        <div className="mt-1.5"><TxStatus state={tx} explorerUrl={explorerTxUrl(side)} /></div>
      </div>
    );
  }

  const isTestnet = home.evmChain?.isTestnet || remote.evmChain?.isTestnet;

  return (
    <div>
      {isTestnet && (
        <div className="step-info mb-3">
          <span style={{ color: 'var(--secondary)' }}>✓ Testnet</span> — default libraries are assigned automatically.
        </div>
      )}

      <p className="step-hint">
        Set libraries in <strong>both directions</strong>. Each direction needs a send library (source) + receive library (destination).
      </p>

      {/* Direction tabs */}
      <div className="flex gap-2 mb-4">
        <button className={`tab-btn ${direction === 'AtoB' ? 'tab-btn-active' : ''}`}
          onClick={() => setDirection('AtoB')}>
          {home.chainLabel} → {remote.chainLabel}
          {abSendTx.status === 'success' && abRecvTx.status === 'success' && <span className="ml-1.5 text-[var(--secondary)]">✓</span>}
        </button>
        <button className={`tab-btn ${direction === 'BtoA' ? 'tab-btn-active' : ''}`}
          onClick={() => setDirection('BtoA')}>
          {remote.chainLabel} → {home.chainLabel}
          {baSendTx.status === 'success' && baRecvTx.status === 'success' && <span className="ml-1.5 text-[var(--secondary)]">✓</span>}
        </button>
      </div>

      {direction === 'AtoB' && (
        <div className="step-actions">
          {renderSide('Send Library', home, abSendLib, setAbSendLib,
            verifyResult?.homeSendLib, false, true, abSendTx, setAbSendTx, remote.chain.eid)}
          {renderSide('Receive Library', remote, abRecvLib, setAbRecvLib,
            verifyResult?.remoteReceiveLib, verifyResult?.remoteReceiveLibIsDefault,
            false, abRecvTx, setAbRecvTx, home.chain.eid)}
        </div>
      )}

      {direction === 'BtoA' && (
        <div className="step-actions">
          {renderSide('Send Library', remote, baSendLib, setBaSendLib,
            verifyResult?.remoteSendLib, false, true, baSendTx, setBaSendTx, home.chain.eid)}
          {renderSide('Receive Library', home, baRecvLib, setBaRecvLib,
            verifyResult?.homeReceiveLib, verifyResult?.homeReceiveLibIsDefault,
            false, baRecvTx, setBaRecvTx, remote.chain.eid)}
        </div>
      )}
    </div>
  );
}
