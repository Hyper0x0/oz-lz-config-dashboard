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
 * Per-chain DVN & Executor configuration.
 *
 * Mental model: select DVNs once per chain.
 * Chain A DVNs → used for A's send config (A→B) AND A's receive config (B→A).
 * Chain B DVNs → used for B's send config (B→A) AND B's receive config (A→B).
 *
 * The DVN *providers* must match across chains (e.g. "LayerZero Labs" on both),
 * but addresses differ per chain.
 */
export function StepDVN({ home, remote, hooks, verifyResult, homePrefill, remotePrefill, onTxSuccess }: StepProps): JSX.Element {
  const epConfig = useEndpointConfig(hooks.evm.signer);

  // ── Per-chain DVN selection ──────────────────────────────────────────────
  const [homeDvns, setHomeDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [remoteDvns, setRemoteDvns] = useState<Map<string, DVNProvider>>(new Map());

  // TX state: 2 tx per chain (send + receive config) — Stark uses combinedTx instead.
  const [homeSendTx, setHomeSendTx] = useState<TxState>({ status: 'idle' });
  const [homeRecvTx, setHomeRecvTx] = useState<TxState>({ status: 'idle' });
  const [remoteSendTx, setRemoteSendTx] = useState<TxState>({ status: 'idle' });
  const [remoteRecvTx, setRemoteRecvTx] = useState<TxState>({ status: 'idle' });
  const [homeBothTx, setHomeBothTx] = useState<TxState>({ status: 'idle' });
  const [remoteBothTx, setRemoteBothTx] = useState<TxState>({ status: 'idle' });

  // Shared config — use chain defaults
  const homeDefaults = home.evmChain?.defaults ?? home.starkChain?.defaults;
  const remoteDefaults = remote.evmChain?.defaults ?? remote.starkChain?.defaults;
  const [homeConfirmations, setHomeConfirmations] = useState(String(homeDefaults?.confirmations ?? 15));
  const [remoteConfirmations, setRemoteConfirmations] = useState(String(remoteDefaults?.confirmations ?? 15));
  const [maxMsgSize, setMaxMsgSize] = useState('10000');

  // Executors per chain
  const homeExecutor = home.evmChain?.executor ?? home.starkChain?.executor ?? '';
  const remoteExecutor = remote.evmChain?.executor ?? remote.starkChain?.executor ?? '';
  const [homeExecOverride, setHomeExecOverride] = useState('');
  const [remoteExecOverride, setRemoteExecOverride] = useState('');

  // Library addresses
  const homeSendLib = verifyResult?.homeSendLib ?? home.evmChain?.sendLib ?? home.starkChain?.sendLib ?? '';
  const homeRecvLib = verifyResult?.homeReceiveLib ?? home.evmChain?.receiveLib ?? home.starkChain?.receiveLib ?? '';
  const remoteSendLib = verifyResult?.remoteSendLib ?? remote.evmChain?.sendLib ?? remote.starkChain?.sendLib ?? '';
  const remoteRecvLib = verifyResult?.remoteReceiveLib ?? remote.evmChain?.receiveLib ?? remote.starkChain?.receiveLib ?? '';

  const homeChainKey = home.evmChain?.chainKey ?? home.starkChain?.chainKey ?? '';
  const remoteChainKey = remote.evmChain?.chainKey ?? remote.starkChain?.chainKey ?? '';

  const { dvns: homeCatalog } = useDVNCatalog(homeChainKey);
  const { dvns: remoteCatalog } = useDVNCatalog(remoteChainKey);

  function resolveDvn(addr: string, catalog: DVNProvider[]): DVNProvider {
    const found = catalog.find((d) => d.address.toLowerCase() === addr.toLowerCase());
    return found ?? { name: addr.slice(0, 10) + '…', address: addr, color: '#888' };
  }

  // Auto-fill from verify results OR from on-chain prefill (which works for mixed Stark↔EVM pathways too)
  useEffect(() => {
    if (homeDvns.size > 0) return;
    const dvnList = verifyResult?.homeDVN?.requiredDVNs
      ?? verifyResult?.homeReceiveDVN?.requiredDVNs
      ?? homePrefill?.sendDvns
      ?? homePrefill?.recvDvns;
    if (!dvnList?.length) return;
    const pre = new Map<string, DVNProvider>();
    for (const addr of dvnList) pre.set(addr.toLowerCase(), resolveDvn(addr, homeCatalog));
    if (pre.size > 0) setHomeDvns(pre);
  }, [verifyResult?.homeDVN?.requiredDVNs?.length, verifyResult?.homeReceiveDVN?.requiredDVNs?.length, homePrefill?.sendDvns?.length, homePrefill?.recvDvns?.length, homeCatalog.length]); // eslint-disable-line

  useEffect(() => {
    if (remoteDvns.size > 0) return;
    const dvnList = verifyResult?.remoteSendDVN?.requiredDVNs
      ?? verifyResult?.remoteDVN?.requiredDVNs
      ?? remotePrefill?.sendDvns
      ?? remotePrefill?.recvDvns;
    if (!dvnList?.length) return;
    const pre = new Map<string, DVNProvider>();
    for (const addr of dvnList) pre.set(addr.toLowerCase(), resolveDvn(addr, remoteCatalog));
    if (pre.size > 0) setRemoteDvns(pre);
  }, [verifyResult?.remoteSendDVN?.requiredDVNs?.length, verifyResult?.remoteDVN?.requiredDVNs?.length, remotePrefill?.sendDvns?.length, remotePrefill?.recvDvns?.length, remoteCatalog.length]); // eslint-disable-line

  // Pre-fill confirmations + executor override from on-chain reads (mixed pathways).
  useEffect(() => {
    if (homePrefill?.confirmations !== undefined) setHomeConfirmations(String(homePrefill.confirmations));
    if (homePrefill?.executor && !homeExecutor) setHomeExecOverride(homePrefill.executor);
  }, [homePrefill?.confirmations, homePrefill?.executor]); // eslint-disable-line
  useEffect(() => {
    if (remotePrefill?.confirmations !== undefined) setRemoteConfirmations(String(remotePrefill.confirmations));
    if (remotePrefill?.executor && !remoteExecutor) setRemoteExecOverride(remotePrefill.executor);
  }, [remotePrefill?.confirmations, remotePrefill?.executor]); // eslint-disable-line

  // ── Set config handlers ───────────────────────────────────────────────────

  async function handleSetConfig(
    side: typeof home, lib: string, remoteEid: number, dvns: Map<string, DVNProvider>,
    exec: string, confirmations: string, txSetter: (s: TxState) => void, includeExecutor: boolean,
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

  const homeExec = homeExecOverride || homeExecutor;
  const remoteExec = remoteExecOverride || remoteExecutor;

  // Stark-only: one click for send + receive ULN config (sendLib === recvLib on Starknet).
  async function handleSetStarkBoth(
    side: typeof home, lib: string, remoteEid: number, dvns: Map<string, DVNProvider>,
    exec: string, confirmations: string, txSetter: (s: TxState) => void,
  ): Promise<void> {
    if (side.kind !== 'starknet') return;
    txSetter({ status: 'pending' });
    const dvnAddrs = [...dvns.keys()];
    const result = await hooks.cairoEndpoint.setUlnConfigsBoth(
      side.starkChain!.endpoint, side.contractAddr, lib, remoteEid,
      { confirmations: Number(confirmations), requiredDvns: sortDvns(dvnAddrs) },
      { maxMessageSize: Number(maxMsgSize), executor: exec },
      side.starkChain!.rpc,
    );
    txSetter(result);
    if (result.status === 'success') onTxSuccess(side === home ? 'home' : 'remote');
  }

  // Check if home and remote have same DVN providers (by name) — warn if not
  const homeNames = [...homeDvns.values()].map((d) => d.name).sort();
  const remoteNames = [...remoteDvns.values()].map((d) => d.name).sort();
  const providersMismatch = homeDvns.size > 0 && remoteDvns.size > 0 &&
    (homeNames.length !== remoteNames.length || homeNames.some((n, i) => n !== remoteNames[i]));

  // Confirmations rule check: source.send.confirmations must be >= destination.recv.confirmations
  // for each direction. Since the dashboard uses one field per chain, we just compare the two values.
  const homeConfNum = Number(homeConfirmations) || 0;
  const remoteConfNum = Number(remoteConfirmations) || 0;
  const confirmationsMismatch = homeConfNum > 0 && remoteConfNum > 0 && homeConfNum !== remoteConfNum;

  return (
    <div>
      <p className="step-hint">
        Select DVN providers <strong>per chain</strong>. The same providers must be selected on both chains
        (addresses differ, but providers like "LayerZero Labs" must match). Each chain's DVNs are used for both
        its send config and the other chain's receive config.
      </p>
      <p className="step-hint">
        <strong>Confirmations rule:</strong> for every direction, the source's outbound confirmations must be{' '}
        <strong>≥</strong> the destination's inbound confirmations — otherwise the destination ULN rejects the
        message with <code>Outbound confirmations must be &gt;= inbound confirmations</code>. The simplest valid
        setup is to use the <strong>same value on both chains</strong>.
      </p>

      {confirmationsMismatch && (
        <div className="flex items-center gap-2 bg-tertiary/5 border border-tertiary/20 rounded-lg px-3 py-2 mb-4 text-xs text-tertiary">
          <span>
            Confirmations differ ({home.chainLabel}: {homeConfNum}, {remote.chainLabel}: {remoteConfNum}). One direction will revert at the destination ULN unless source.send ≥ dest.recv. Use the same value on both chains for the safest setup.
          </span>
        </div>
      )}

      {providersMismatch && (
        <div className="flex items-center gap-2 bg-tertiary/5 border border-tertiary/20 rounded-lg px-3 py-2 mb-4 text-xs text-tertiary">
          <span>DVN providers don't match across chains — both chains must use the same set of providers, or messages will be rejected.</span>
        </div>
      )}

      <div className="step-actions" style={{ alignItems: 'start' }}>
        {/* ── Chain A (Home) ── */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary mb-3">
            {home.chainLabel}
          </div>

          <div className="mb-3">
            <div className="label">DVN providers</div>
            <DVNPicker chainKey={homeChainKey} selected={homeDvns} onToggle={(a, p) => {
              setHomeDvns((prev) => { const next = new Map(prev); next.has(a) ? next.delete(a) : next.set(a, p); return next; });
            }} />
            {homeDvns.size === 0 && <div className="text-[11px] text-[var(--text-muted)] mt-1">Select at least one DVN</div>}
          </div>

          <div className="form-grid mb-3">
            <div>
              <div className="label">Block confirmations</div>
              <input className="input" value={homeConfirmations} onChange={(e) => setHomeConfirmations(e.target.value)}
                placeholder={String(homeDefaults?.confirmations ?? 15)} />
              {homeDefaults && (
                <div className="text-[11px] text-[var(--text-muted)] mt-1">
                  Recommended: {homeDefaults.confirmations} · {homeDefaults.requiredDVNs}+ DVNs · must be ≥ {remote.chainLabel} confirmations
                </div>
              )}
            </div>
            <div>
              <div className="label">Executor</div>
              <input className="input" value={homeExec}
                onChange={(e) => setHomeExecOverride(e.target.value)}
                readOnly={!!homeExecutor && !homeExecOverride}
                style={homeExecutor && !homeExecOverride ? { color: 'var(--text-muted)' } : undefined} />
            </div>
          </div>

          {/* Stark: one button does both send + receive (sendLib === recvLib). EVM: two separate buttons. */}
          {home.kind === 'starknet' ? (
            <div>
              <NetworkHint side={home} />
              <button className="btn btn-primary"
                disabled={!home.isConnected || homeDvns.size === 0 || !homeSendLib}
                onClick={() => handleSetStarkBoth(home, homeSendLib, remote.chain.eid, homeDvns, homeExec, homeConfirmations, setHomeBothTx)}>
                Set Send + Receive Config
              </button>
              <div className="mt-1.5"><TxStatus state={homeBothTx} explorerUrl={explorerTxUrl(home)} /></div>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <NetworkHint side={home} />
                <button className="btn btn-primary"
                  disabled={!home.isConnected || home.needsNetworkSwitch || homeDvns.size === 0 || !homeSendLib}
                  onClick={() => handleSetConfig(home, homeSendLib, remote.chain.eid, homeDvns, homeExec, homeConfirmations, setHomeSendTx, true)}>
                  Set Send Config ({home.chainLabel} → {remote.chainLabel})
                </button>
                <div className="mt-1.5"><TxStatus state={homeSendTx} explorerUrl={explorerTxUrl(home)} /></div>
              </div>
              <div>
                <button className="btn btn-primary"
                  disabled={!home.isConnected || home.needsNetworkSwitch || homeDvns.size === 0 || !homeRecvLib}
                  onClick={() => handleSetConfig(home, homeRecvLib, remote.chain.eid, homeDvns, '', homeConfirmations, setHomeRecvTx, false)}>
                  Set Receive Config ({remote.chainLabel} → {home.chainLabel})
                </button>
                <div className="mt-1.5"><TxStatus state={homeRecvTx} explorerUrl={explorerTxUrl(home)} /></div>
              </div>
            </>
          )}
        </div>

        {/* ── Chain B (Remote) ── */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary mb-3">
            {remote.chainLabel}
          </div>

          <div className="mb-3">
            <div className="label">DVN providers</div>
            <DVNPicker chainKey={remoteChainKey} selected={remoteDvns} onToggle={(a, p) => {
              setRemoteDvns((prev) => { const next = new Map(prev); next.has(a) ? next.delete(a) : next.set(a, p); return next; });
            }} />
            {remoteDvns.size === 0 && <div className="text-[11px] text-[var(--text-muted)] mt-1">Select at least one DVN</div>}
          </div>

          <div className="form-grid mb-3">
            <div>
              <div className="label">Block confirmations</div>
              <input className="input" value={remoteConfirmations} onChange={(e) => setRemoteConfirmations(e.target.value)}
                placeholder={String(remoteDefaults?.confirmations ?? 15)} />
              {remoteDefaults && (
                <div className="text-[11px] text-[var(--text-muted)] mt-1">
                  Recommended: {remoteDefaults.confirmations} · {remoteDefaults.requiredDVNs}+ DVNs · must be ≥ {home.chainLabel} confirmations
                </div>
              )}
            </div>
            <div>
              <div className="label">Executor</div>
              <input className="input" value={remoteExec}
                onChange={(e) => setRemoteExecOverride(e.target.value)}
                readOnly={!!remoteExecutor && !remoteExecOverride}
                style={remoteExecutor && !remoteExecOverride ? { color: 'var(--text-muted)' } : undefined} />
            </div>
          </div>

          {remote.kind === 'starknet' ? (
            <div>
              <NetworkHint side={remote} />
              <button className="btn btn-primary"
                disabled={!remote.isConnected || remoteDvns.size === 0 || !remoteSendLib}
                onClick={() => handleSetStarkBoth(remote, remoteSendLib, home.chain.eid, remoteDvns, remoteExec, remoteConfirmations, setRemoteBothTx)}>
                Set Send + Receive Config
              </button>
              <div className="mt-1.5"><TxStatus state={remoteBothTx} explorerUrl={explorerTxUrl(remote)} /></div>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <NetworkHint side={remote} />
                <button className="btn btn-primary"
                  disabled={!remote.isConnected || remote.needsNetworkSwitch || remoteDvns.size === 0 || !remoteSendLib}
                  onClick={() => handleSetConfig(remote, remoteSendLib, home.chain.eid, remoteDvns, remoteExec, remoteConfirmations, setRemoteSendTx, true)}>
                  Set Send Config ({remote.chainLabel} → {home.chainLabel})
                </button>
                <div className="mt-1.5"><TxStatus state={remoteSendTx} explorerUrl={explorerTxUrl(remote)} /></div>
              </div>
              <div>
                <button className="btn btn-primary"
                  disabled={!remote.isConnected || remote.needsNetworkSwitch || remoteDvns.size === 0 || !remoteRecvLib}
                  onClick={() => handleSetConfig(remote, remoteRecvLib, home.chain.eid, remoteDvns, '', remoteConfirmations, setRemoteRecvTx, false)}>
                  Set Receive Config ({home.chainLabel} → {remote.chainLabel})
                </button>
                <div className="mt-1.5"><TxStatus state={remoteRecvTx} explorerUrl={explorerTxUrl(remote)} /></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
