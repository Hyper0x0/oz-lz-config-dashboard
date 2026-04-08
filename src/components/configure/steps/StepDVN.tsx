import { useState, useEffect } from 'react';
import { TxStatus } from '@/components/TxStatus';
import { useEndpointConfig } from '@/hooks/useEndpointConfig';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import { DVNPicker } from '../DVNPicker';
import { sortDvns } from '@/utils/cairoLzConfig';
import type { TxState, DVNProvider } from '@/types';
import type { StepProps } from '../types';
import { explorerTxUrl } from '../types';
import { NetworkHint } from './StepDelegate';

/**
 * Bidirectional DVN & Executor configuration.
 * A→B: home send config + remote receive config
 * B→A: remote send config + home receive config
 */
export function StepDVN({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const epConfig = useEndpointConfig(hooks.evm.signer);
  const [direction, setDirection] = useState<'AtoB' | 'BtoA'>('AtoB');

  // ── A→B state ─────────────────────────────────────────────────────────────
  const [abSendDvns, setAbSendDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [abRecvDvns, setAbRecvDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [abSendTx, setAbSendTx] = useState<TxState>({ status: 'idle' });
  const [abRecvTx, setAbRecvTx] = useState<TxState>({ status: 'idle' });

  // ── B→A state ─────────────────────────────────────────────────────────────
  const [baSendDvns, setBaSendDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [baRecvDvns, setBaRecvDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [baSendTx, setBaSendTx] = useState<TxState>({ status: 'idle' });
  const [baRecvTx, setBaRecvTx] = useState<TxState>({ status: 'idle' });

  // Shared config
  const [confirmations, setConfirmations] = useState(home.evmChain?.isTestnet ? '1' : '15');
  const [maxMsgSize, setMaxMsgSize] = useState('10000');

  // Executors per chain
  const homeExecutor = home.evmChain?.executor ?? home.starkChain?.executor ?? '';
  const remoteExecutor = remote.evmChain?.executor ?? remote.starkChain?.executor ?? '';
  const [homeExecOverride, setHomeExecOverride] = useState('');
  const [remoteExecOverride, setRemoteExecOverride] = useState('');

  // Library addresses
  const homeSendLib = verifyResult?.homeSendLib ?? home.evmChain?.sendLib ?? home.starkChain?.sendLib ?? '';
  const remoteRecvLib = verifyResult?.remoteReceiveLib ?? remote.evmChain?.receiveLib ?? remote.starkChain?.receiveLib ?? '';
  const remoteSendLib = verifyResult?.remoteSendLib ?? remote.evmChain?.sendLib ?? remote.starkChain?.sendLib ?? '';
  const homeRecvLib = verifyResult?.homeReceiveLib ?? home.evmChain?.receiveLib ?? home.starkChain?.receiveLib ?? '';

  const homeChainKey = home.evmChain?.chainKey ?? home.starkChain?.chainKey ?? '';
  const remoteChainKey = remote.evmChain?.chainKey ?? remote.starkChain?.chainKey ?? '';

  // Use catalog for DVN name/icon resolution during auto-fill
  const { dvns: homeCatalog } = useDVNCatalog(homeChainKey);
  const { dvns: remoteCatalog } = useDVNCatalog(remoteChainKey);

  /** Resolve a DVN address to a full provider object using the catalog, fallback to truncated address */
  function resolveDvn(addr: string, catalog: DVNProvider[]): DVNProvider {
    const found = catalog.find((d) => d.address.toLowerCase() === addr.toLowerCase());
    return found ?? { name: addr.slice(0, 10) + '…', address: addr, color: '#888' };
  }

  // Auto-fill from verify results — resolve names from catalog
  useEffect(() => {
    if (!verifyResult?.homeDVN?.requiredDVNs?.length || abSendDvns.size > 0) return;
    const pre = new Map<string, DVNProvider>();
    for (const addr of verifyResult.homeDVN.requiredDVNs) pre.set(addr.toLowerCase(), resolveDvn(addr, homeCatalog));
    if (pre.size > 0) setAbSendDvns(pre);
  }, [verifyResult?.homeDVN?.requiredDVNs?.length, homeCatalog.length]); // eslint-disable-line

  useEffect(() => {
    if (!verifyResult?.remoteDVN?.requiredDVNs?.length || abRecvDvns.size > 0) return;
    const pre = new Map<string, DVNProvider>();
    for (const addr of verifyResult.remoteDVN.requiredDVNs) pre.set(addr.toLowerCase(), resolveDvn(addr, remoteCatalog));
    if (pre.size > 0) setAbRecvDvns(pre);
  }, [verifyResult?.remoteDVN?.requiredDVNs?.length, remoteCatalog.length]); // eslint-disable-line

  useEffect(() => {
    if (!verifyResult?.remoteSendDVN?.requiredDVNs?.length || baSendDvns.size > 0) return;
    const pre = new Map<string, DVNProvider>();
    for (const addr of verifyResult.remoteSendDVN.requiredDVNs) pre.set(addr.toLowerCase(), resolveDvn(addr, remoteCatalog));
    if (pre.size > 0) setBaSendDvns(pre);
  }, [verifyResult?.remoteSendDVN?.requiredDVNs?.length, remoteCatalog.length]); // eslint-disable-line

  useEffect(() => {
    if (!verifyResult?.homeReceiveDVN?.requiredDVNs?.length || baRecvDvns.size > 0) return;
    const pre = new Map<string, DVNProvider>();
    for (const addr of verifyResult.homeReceiveDVN.requiredDVNs) pre.set(addr.toLowerCase(), resolveDvn(addr, homeCatalog));
    if (pre.size > 0) setBaRecvDvns(pre);
  }, [verifyResult?.homeReceiveDVN?.requiredDVNs?.length, homeCatalog.length]); // eslint-disable-line

  function toggleDvn(dir: 'AtoB' | 'BtoA', side: 'send' | 'recv', addr: string, p: DVNProvider): void {
    const setter = dir === 'AtoB'
      ? (side === 'send' ? setAbSendDvns : setAbRecvDvns)
      : (side === 'send' ? setBaSendDvns : setBaRecvDvns);
    setter((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, p); return next; });
  }

  // ── Set config handlers ───────────────────────────────────────────────────

  async function handleSetConfig(
    side: typeof home, lib: string, remoteEid: number, dvns: Map<string, DVNProvider>,
    exec: string, txSetter: (s: TxState) => void, includeExecutor: boolean,
  ): Promise<void> {
    txSetter({ status: 'pending' });
    const dvnAddrs = [...dvns.keys()];
    let result: TxState;
    if (side.kind === 'starknet') {
      if (includeExecutor) {
        result = await hooks.cairoEndpoint.setSendConfigsAtomic(
          side.starkChain!.endpoint, side.contractAddr, lib, remoteEid,
          { confirmations: Number(confirmations), requiredDvns: sortDvns(dvnAddrs) },
          { maxMessageSize: Number(maxMsgSize), executor: exec },
          side.starkChain!.rpc,
        );
      } else {
        result = await hooks.cairoEndpoint.setUlnReceiveConfig(
          side.starkChain!.endpoint, side.contractAddr, lib, remoteEid,
          { confirmations: Number(confirmations), requiredDvns: sortDvns(dvnAddrs) },
          side.starkChain!.rpc,
        );
      }
    } else {
      result = await epConfig.setULNConfig(
        side.evmChain!.endpoint, side.contractAddr, lib, remoteEid,
        { confirmations: Number(confirmations), requiredDVNs: dvnAddrs },
        includeExecutor && exec ? { maxMessageSize: Number(maxMsgSize), executor: exec } : undefined,
      );
    }
    txSetter(result);
    if (result.status === 'success') onTxSuccess(side === home ? 'home' : 'remote');
  }

  // ── Render direction ──────────────────────────────────────────────────────

  function renderDirection(
    dir: 'AtoB' | 'BtoA',
    srcSide: typeof home, dstSide: typeof remote,
    sendDvns: Map<string, DVNProvider>, recvDvns: Map<string, DVNProvider>,
    srcLib: string, dstLib: string,
    srcExec: string, srcExecOverride: string, setSrcExecOverride: (v: string) => void,
    sendTx: TxState, recvTx: TxState,
    setSendTx: (s: TxState) => void, setRecvTx: (s: TxState) => void,
    srcChainKey: string, dstChainKey: string,
  ): JSX.Element {
    const effectiveExec = srcExecOverride || srcExec;
    return (
      <div>
        <div className="form-grid mb-3">
          <div>
            <div className="label">Block confirmations</div>
            <input className="input" value={confirmations} onChange={(e) => setConfirmations(e.target.value)} placeholder="15" />
          </div>
          <div>
            <div className="label">Executor ({srcSide.chainLabel})</div>
            {srcExec
              ? <div className="text-[11px] text-[var(--text-muted)] mb-1">Auto-filled from LZ API</div>
              : <div className="text-[11px] text-[var(--text-muted)] mb-1">Enter manually</div>}
            <input className="input" value={effectiveExec}
              onChange={(e) => setSrcExecOverride(e.target.value)}
              readOnly={!!srcExec && !srcExecOverride}
              style={srcExec && !srcExecOverride ? { color: 'var(--text-muted)' } : undefined} />
          </div>
        </div>

        <div className="step-actions" style={{ alignItems: 'start' }}>
          {/* Send Config (on source chain) */}
          <div>
            <div className="label mb-1">Send DVNs — {srcSide.chainLabel}</div>
            <DVNPicker chainKey={srcChainKey} selected={sendDvns} onToggle={(a, p) => toggleDvn(dir, 'send', a, p)} />
            {sendDvns.size === 0 && <div className="text-[11px] text-[var(--text-muted)] mt-1">Select at least one DVN</div>}
            <div className="mt-2">
              <NetworkHint side={srcSide} />
              <button className="btn btn-primary"
                disabled={!srcSide.isConnected || srcSide.needsNetworkSwitch || sendDvns.size === 0 || !srcLib}
                onClick={() => handleSetConfig(srcSide, srcLib, dstSide.chain.eid, sendDvns, effectiveExec, setSendTx, true)}>
                Set Send Config
              </button>
              <div className="mt-1.5"><TxStatus state={sendTx} explorerUrl={explorerTxUrl(srcSide)} /></div>
            </div>
          </div>

          {/* Receive Config (on destination chain) */}
          <div>
            <div className="label mb-1">Receive DVNs — {dstSide.chainLabel}</div>
            <DVNPicker chainKey={dstChainKey} selected={recvDvns} onToggle={(a, p) => toggleDvn(dir, 'recv', a, p)} />
            {recvDvns.size === 0 && <div className="text-[11px] text-[var(--text-muted)] mt-1">Select at least one DVN</div>}
            <div className="mt-2">
              <NetworkHint side={dstSide} />
              <button className="btn btn-primary"
                disabled={!dstSide.isConnected || dstSide.needsNetworkSwitch || recvDvns.size === 0 || !dstLib}
                onClick={() => handleSetConfig(dstSide, dstLib, srcSide.chain.eid, recvDvns, '', setRecvTx, false)}>
                Set Receive Config
              </button>
              <div className="mt-1.5"><TxStatus state={recvTx} explorerUrl={explorerTxUrl(dstSide)} /></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="step-hint">
        Configure DVN providers in <strong>both directions</strong>. Each direction needs send config (source chain) + receive config (destination chain).
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

      {direction === 'AtoB' && renderDirection(
        'AtoB', home, remote,
        abSendDvns, abRecvDvns,
        homeSendLib, remoteRecvLib,
        homeExecutor, homeExecOverride, setHomeExecOverride,
        abSendTx, abRecvTx, setAbSendTx, setAbRecvTx,
        homeChainKey, remoteChainKey,
      )}

      {direction === 'BtoA' && renderDirection(
        'BtoA', remote, home,
        baSendDvns, baRecvDvns,
        remoteSendLib, homeRecvLib,
        remoteExecutor, remoteExecOverride, setRemoteExecOverride,
        baSendTx, baRecvTx, setBaSendTx, setBaRecvTx,
        remoteChainKey, homeChainKey,
      )}
    </div>
  );
}
