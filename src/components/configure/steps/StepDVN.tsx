import { useState, useEffect } from 'react';
import { TxStatus } from '@/components/TxStatus';
import { useEndpointConfig } from '@/hooks/useEndpointConfig';
import { DVNPicker } from '../DVNPicker';
import { sortDvns } from '@/utils/cairoLzConfig';
import type { TxState, DVNProvider } from '@/types';
import type { StepProps } from '../types';
import { NetworkHint } from './StepDelegate';

export function StepDVN({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const epConfig = useEndpointConfig(hooks.evm.signer);

  // DVN selection — per side
  const [homeDvns, setHomeDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [remoteDvns, setRemoteDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [sameRecvDvns, setSameRecvDvns] = useState(true);

  // Shared config
  const [confirmations, setConfirmations] = useState(home.evmChain?.isTestnet ? '1' : '15');
  const [maxMsgSize, setMaxMsgSize] = useState('10000');

  // Executor — auto-filled from chain metadata when available
  const homeExecutor = home.evmChain?.executor ?? home.starkChain?.executor ?? '';
  const [executorOverride, setExecutorOverride] = useState('');
  const executor = executorOverride || homeExecutor;

  // Library addresses — from verify result or chain catalog
  const homeSendLib = verifyResult?.homeSendLib ?? home.evmChain?.sendLib ?? home.starkChain?.sendLib ?? '';
  const remoteRecvLib = verifyResult?.remoteReceiveLib ?? remote.evmChain?.receiveLib ?? remote.starkChain?.receiveLib ?? '';

  // Tx states
  const [sendTx, setSendTx] = useState<TxState>({ status: 'idle' });
  const [recvTx, setRecvTx] = useState<TxState>({ status: 'idle' });

  // Auto-fill DVN selections from verify results
  useEffect(() => {
    if (!verifyResult?.homeDVN?.requiredDVNs?.length || homeDvns.size > 0) return;
    // We'd need the catalog to resolve addresses to providers, but for pre-fill
    // we create minimal providers from the addresses
    const pre = new Map<string, DVNProvider>();
    for (const addr of verifyResult.homeDVN.requiredDVNs) {
      pre.set(addr.toLowerCase(), { name: addr.slice(0, 10) + '…', address: addr, color: '#888' });
    }
    if (pre.size > 0) setHomeDvns(pre);
  }, [verifyResult?.homeDVN?.requiredDVNs?.length]); // eslint-disable-line

  useEffect(() => {
    if (!verifyResult?.remoteDVN?.requiredDVNs?.length || remoteDvns.size > 0) return;
    const pre = new Map<string, DVNProvider>();
    for (const addr of verifyResult.remoteDVN.requiredDVNs) {
      pre.set(addr.toLowerCase(), { name: addr.slice(0, 10) + '…', address: addr, color: '#888' });
    }
    if (pre.size > 0) setRemoteDvns(pre);
  }, [verifyResult?.remoteDVN?.requiredDVNs?.length]); // eslint-disable-line

  function toggleHome(addr: string, p: DVNProvider): void {
    setHomeDvns((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, p); return next; });
    if (sameRecvDvns) {
      setRemoteDvns((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, p); return next; });
    }
  }

  function toggleRemote(addr: string, p: DVNProvider): void {
    setRemoteDvns((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, p); return next; });
  }

  // ── Home: Set Send Config (DVN + Executor) ────────────────────────────────
  async function handleSend(): Promise<void> {
    setSendTx({ status: 'pending' });
    const dvnAddrs = [...homeDvns.keys()];
    let result: TxState;

    if (home.kind === 'starknet') {
      result = await hooks.cairoEndpoint.setSendConfigsAtomic(
        home.starkChain!.endpoint, home.contractAddr, homeSendLib, remote.chain.eid,
        { confirmations: Number(confirmations), requiredDvns: sortDvns(dvnAddrs) },
        { maxMessageSize: Number(maxMsgSize), executor },
        home.starkChain!.rpc,
      );
    } else {
      result = await epConfig.setULNConfig(
        home.evmChain!.endpoint, home.contractAddr, homeSendLib, remote.chain.eid,
        { confirmations: Number(confirmations), requiredDVNs: dvnAddrs },
        executor ? { maxMessageSize: Number(maxMsgSize), executor } : undefined,
      );
    }
    setSendTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  // ── Remote: Set Receive Config (DVN only) ─────────────────────────────────
  async function handleRecv(): Promise<void> {
    setRecvTx({ status: 'pending' });
    const dvnAddrs = sameRecvDvns ? [...homeDvns.keys()] : [...remoteDvns.keys()];
    let result: TxState;

    if (remote.kind === 'starknet') {
      result = await hooks.cairoEndpoint.setUlnReceiveConfig(
        remote.starkChain!.endpoint, remote.contractAddr, remoteRecvLib, home.chain.eid,
        { confirmations: Number(confirmations), requiredDvns: sortDvns(dvnAddrs) },
        remote.starkChain!.rpc,
      );
    } else {
      result = await epConfig.setULNConfig(
        remote.evmChain!.endpoint, remote.contractAddr, remoteRecvLib, home.chain.eid,
        { confirmations: Number(confirmations), requiredDVNs: dvnAddrs },
      );
    }
    setRecvTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  const homeChainKey = home.evmChain?.chainKey ?? home.starkChain?.chainKey ?? '';
  const remoteChainKey = remote.evmChain?.chainKey ?? remote.starkChain?.chainKey ?? '';

  return (
    <div>
      <p className="step-hint">
        Configure which DVN providers verify messages and minimum block confirmations.
        {home.kind === 'starknet' || remote.kind === 'starknet'
          ? ' DVN and executor are set atomically on Starknet (LZ recommended).'
          : ' Executor is auto-filled from LZ metadata.'}
      </p>

      {/* Shared config */}
      <div className="form-grid mb-3">
        <div>
          <div className="label">Block confirmations</div>
          <input className="input" value={confirmations} onChange={(e) => setConfirmations(e.target.value)} placeholder="15" />
        </div>
        <div>
          <div className="label">Executor</div>
          {homeExecutor
            ? <div className="text-[11px] text-[var(--text-muted)] mb-1">Auto-filled from LZ API</div>
            : <div className="text-[11px] text-[var(--text-muted)] mb-1">Enter manually</div>}
          <input className="input" value={executor}
            onChange={(e) => setExecutorOverride(e.target.value)}
            readOnly={!!homeExecutor && !executorOverride}
            style={homeExecutor && !executorOverride ? { color: 'var(--text-muted)' } : undefined} />
        </div>
      </div>

      {/* Same-DVNs toggle */}
      <label className="flex items-center gap-2 text-xs cursor-pointer mb-3" style={{ color: 'var(--text)' }}>
        <input type="checkbox" checked={sameRecvDvns} onChange={(e) => {
          setSameRecvDvns(e.target.checked);
          if (e.target.checked) setRemoteDvns(new Map(homeDvns));
        }} style={{ accentColor: 'var(--accent)' }} />
        Use same DVNs for send and receive (recommended)
      </label>

      <div className="step-actions" style={{ alignItems: 'start' }}>
        {/* Home: Send Config */}
        <div>
          <div className="label mb-1">Send DVNs — {home.chainLabel}</div>
          <DVNPicker chainKey={homeChainKey} selected={homeDvns} onToggle={toggleHome} />
          {homeDvns.size === 0 && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1">Select at least one DVN</div>
          )}
          <div className="mt-2">
            <NetworkHint side={home} />
            <button className="btn btn-primary"
              disabled={!home.isConnected || home.needsNetworkSwitch || homeDvns.size === 0 || !homeSendLib}
              onClick={handleSend}>
              Set Send Config
            </button>
            <div className="mt-1.5"><TxStatus state={sendTx} /></div>
          </div>
        </div>

        {/* Remote: Receive Config */}
        <div>
          <div className="label mb-1">Receive DVNs — {remote.chainLabel}</div>
          {sameRecvDvns
            ? <div className="text-xs text-[var(--text-muted)] mb-2">Using same DVNs as send direction</div>
            : <DVNPicker chainKey={remoteChainKey} selected={remoteDvns} onToggle={toggleRemote} />
          }
          {!sameRecvDvns && remoteDvns.size === 0 && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1">Select at least one DVN</div>
          )}
          <div className="mt-2">
            <NetworkHint side={remote} />
            <button className="btn btn-primary"
              disabled={!remote.isConnected || remote.needsNetworkSwitch ||
                (sameRecvDvns ? homeDvns.size === 0 : remoteDvns.size === 0) || !remoteRecvLib}
              onClick={handleRecv}>
              Set Receive Config
            </button>
            <div className="mt-1.5"><TxStatus state={recvTx} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
