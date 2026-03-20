import { useState, useRef, useEffect } from 'react';
import { TxStatus } from '@/components/TxStatus';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import { useEndpointConfig } from '@/hooks/useEndpointConfig';
import type { LZChain } from '@/config/lzCatalog';
import type { TxState, PathwayVerifyResult, DVNProvider } from '@/types';
import type { useOFTWiring } from '@/hooks/useOFTWiring';
import { JsonRpcSigner } from 'ethers';

type Wiring = ReturnType<typeof useOFTWiring>;

interface Props {
  homeChain: LZChain;
  remoteChain: LZChain;
  adapterAddr: string;
  peerAddr: string;
  connectedChainId: number | null;
  isConnected: boolean;
  signer: JsonRpcSigner | null;
  onSwitchNetwork: (chainId: number) => void;
  wiring: Wiring;
  verifyResult: PathwayVerifyResult | null;
}

export function GuidedConfigure({
  homeChain, remoteChain, adapterAddr, peerAddr,
  connectedChainId, isConnected, signer, onSwitchNetwork, wiring, verifyResult,
}: Props): JSX.Element {
  const [openStep, setOpenStep] = useState<number | null>(1);
  const toggle = (n: number) => setOpenStep((p) => (p === n ? null : n));

  return (
    <div>
      <Step1Options open={openStep === 1} onToggle={() => toggle(1)}
        homeChain={homeChain} remoteChain={remoteChain}
        adapterAddr={adapterAddr} peerAddr={peerAddr}
        connectedChainId={connectedChainId} isConnected={isConnected}
        onSwitchNetwork={onSwitchNetwork} wiring={wiring} verifyResult={verifyResult} />

      <Step2RateLimit open={openStep === 2} onToggle={() => toggle(2)}
        remoteChain={remoteChain} adapterAddr={adapterAddr}
        connectedChainId={connectedChainId} isConnected={isConnected}
        onSwitchNetwork={onSwitchNetwork} wiring={wiring} verifyResult={verifyResult} />

      <Step3Libraries open={openStep === 3} onToggle={() => toggle(3)}
        homeChain={homeChain} remoteChain={remoteChain}
        adapterAddr={adapterAddr} peerAddr={peerAddr}
        connectedChainId={connectedChainId} isConnected={isConnected}
        signer={signer} onSwitchNetwork={onSwitchNetwork} verifyResult={verifyResult} />

      <Step4DVN open={openStep === 4} onToggle={() => toggle(4)}
        homeChain={homeChain} remoteChain={remoteChain}
        adapterAddr={adapterAddr} peerAddr={peerAddr}
        connectedChainId={connectedChainId} isConnected={isConnected}
        signer={signer} onSwitchNetwork={onSwitchNetwork} verifyResult={verifyResult} />

      <Step5Peers open={openStep === 5} onToggle={() => toggle(5)}
        homeChain={homeChain} remoteChain={remoteChain}
        adapterAddr={adapterAddr} peerAddr={peerAddr}
        connectedChainId={connectedChainId} isConnected={isConnected}
        onSwitchNetwork={onSwitchNetwork} wiring={wiring} verifyResult={verifyResult} />
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function StepCard({ n, title, subtitle, statusBadge, open, onToggle, children }: {
  n: number; title: string; subtitle: string;
  statusBadge?: React.ReactNode; open: boolean;
  onToggle: () => void; children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`step-card${open ? ' step-card-open' : ''}`}>
      <button className="step-header" onClick={onToggle}>
        <span className="step-num">{n}</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{subtitle}</div>
        </div>
        {statusBadge}
        <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="step-body">{children}</div>}
    </div>
  );
}

function ChainSwitch({ label, requiredChainId, requiredChainName, connectedChainId, isConnected, onSwitch }: {
  label: string; requiredChainId: number; requiredChainName: string;
  connectedChainId: number | null; isConnected: boolean; onSwitch: () => void;
}): JSX.Element {
  const ok = isConnected && connectedChainId === requiredChainId;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
      <span style={{ color: '#888' }}>{label}</span>
      {ok
        ? <span style={{ color: '#6bcb77' }}>✓ {requiredChainName}</span>
        : <button className="btn" style={{ padding: '3px 10px', fontSize: 11 }} onClick={onSwitch}>Switch to {requiredChainName}</button>
      }
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}): JSX.Element {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} spellCheck={false} />
    </div>
  );
}

function checkBadge(checks: PathwayVerifyResult['checks'], label: string): React.ReactNode {
  const c = checks.find((x) => x.label === label);
  if (!c) return null;
  return <span style={{ fontSize: 11, color: c.passed ? '#6bcb77' : '#ff6b6b' }}>{c.passed ? '✓' : '✗'}</span>;
}

// ── DVN avatar + dropdown picker ─────────────────────────────────────────────

function DVNAvatar({ provider, size = 20 }: { provider: DVNProvider; size?: number }): JSX.Element {
  const initials = provider.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%',
      background: provider.color + '33', border: `1px solid ${provider.color}`,
      color: provider.color, fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
    }}>
      {initials}
    </span>
  );
}

function DVNDropdown({ chainKey, selected, onToggle }: {
  chainKey: string;
  selected: Map<string, DVNProvider>;
  onToggle: (addr: string, provider: DVNProvider) => void;
}): JSX.Element {
  const { dvns, loading, error } = useDVNCatalog(chainKey);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setQuery('');
  }, [open]);

  const selectedList = [...selected.values()];
  const filtered = dvns.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        className="input dvn-trigger"
        onClick={() => setOpen((o) => !o)}
        type="button"
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
      >
        {selectedList.length === 0
          ? <span style={{ color: '#666' }}>Select DVNs…</span>
          : <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              {selectedList.map((p) => (
                <span key={p.address} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: p.color + '22', border: `1px solid ${p.color}66`,
                  borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
                  <DVNAvatar provider={p} size={14} />
                  {p.name}
                </span>
              ))}
            </span>
        }
        <span style={{ marginLeft: 'auto', color: '#666', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="dvn-dropdown-list">
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #2a2a2a' }}>
            <input
              ref={inputRef}
              className="input"
              placeholder="Search DVNs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{ padding: '5px 8px' }}
            />
          </div>
          {loading && <div style={{ padding: '8px 12px', color: '#888', fontSize: 13 }}>Loading…</div>}
          {error && <div style={{ padding: '8px 12px', color: '#ff6b6b', fontSize: 13 }}>Error: {error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: '8px 12px', color: '#666', fontSize: 13 }}>
              {dvns.length === 0 ? 'No DVNs for this chain' : 'No DVNs match'}
            </div>
          )}
          {filtered.map((p) => {
            const addr = p.address.toLowerCase();
            const checked = selected.has(addr);
            return (
              <label key={p.address} className="dvn-option">
                <input type="checkbox" checked={checked}
                  onChange={() => { onToggle(addr, p); }}
                  onClick={(e) => e.stopPropagation()} />
                <DVNAvatar provider={p} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: '#666' }}>{p.address.slice(0, 12)}…{p.address.slice(-6)}</div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Step 1 — Enforced Options ─────────────────────────────────────────────────

function Step1Options({ open, onToggle, homeChain, remoteChain, adapterAddr, peerAddr,
  connectedChainId, isConnected, onSwitchNetwork, wiring, verifyResult }: {
  open: boolean; onToggle: () => void;
  homeChain: LZChain; remoteChain: LZChain;
  adapterAddr: string; peerAddr: string;
  connectedChainId: number | null; isConnected: boolean;
  onSwitchNetwork: (id: number) => void;
  wiring: Wiring; verifyResult: PathwayVerifyResult | null;
}): JSX.Element {
  const [gas, setGas] = useState('80000');
  const [adapterTx, setAdapterTx] = useState<TxState>({ status: 'idle' });
  const [peerTx, setPeerTx] = useState<TxState>({ status: 'idle' });
  const badge = verifyResult ? checkBadge(verifyResult.checks, 'Enforced options set (send side)') : null;

  return (
    <StepCard n={1} title="Enforced Options" statusBadge={badge} open={open} onToggle={onToggle}
      subtitle="Set minimum gas for lzReceive. Must be set on BOTH sides before opening peers.">
      <Field label="Gas limit for lzReceive" value={gas} onChange={setGas} placeholder="80000" />
      <p className="step-hint">
        Adapter sets options for messages going to the remote chain.
        Peer sets options for messages returning home. Both are required.
      </p>
      <div className="step-actions">
        <div>
          <ChainSwitch label="Adapter (home):" requiredChainId={homeChain.chainId}
            requiredChainName={homeChain.name} connectedChainId={connectedChainId}
            isConnected={isConnected} onSwitch={() => onSwitchNetwork(homeChain.chainId)} />
          <button className="btn btn-primary" disabled={!isConnected || connectedChainId !== homeChain.chainId}
            onClick={async () => { setAdapterTx({ status: 'pending' }); setAdapterTx(await wiring.setEvmEnforcedOptions(adapterAddr, remoteChain.eid, BigInt(gas))); }}>
            Set on Adapter
          </button>
          <div style={{ marginTop: 6 }}><TxStatus state={adapterTx} /></div>
        </div>
        <div>
          <ChainSwitch label="Peer (remote):" requiredChainId={remoteChain.chainId}
            requiredChainName={remoteChain.name} connectedChainId={connectedChainId}
            isConnected={isConnected} onSwitch={() => onSwitchNetwork(remoteChain.chainId)} />
          <button className="btn btn-primary" disabled={!isConnected || connectedChainId !== remoteChain.chainId}
            onClick={async () => { setPeerTx({ status: 'pending' }); setPeerTx(await wiring.setEvmEnforcedOptions(peerAddr, homeChain.eid, BigInt(gas))); }}>
            Set on Peer
          </button>
          <div style={{ marginTop: 6 }}><TxStatus state={peerTx} /></div>
        </div>
      </div>
    </StepCard>
  );
}

// ── Step 2 — Rate Limit ───────────────────────────────────────────────────────

function Step2RateLimit({ open, onToggle, remoteChain, adapterAddr,
  connectedChainId, isConnected, onSwitchNetwork, wiring, verifyResult }: {
  open: boolean; onToggle: () => void;
  remoteChain: LZChain; adapterAddr: string;
  connectedChainId: number | null; isConnected: boolean;
  onSwitchNetwork: (id: number) => void;
  wiring: Wiring; verifyResult: PathwayVerifyResult | null;
}): JSX.Element {
  const [limit, setLimit] = useState('1000000000000000000000000');
  const [window_, setWindow] = useState('3600');
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const rl = verifyResult?.homeRateLimit;
  const badge = verifyResult
    ? <span style={{ fontSize: 11, color: rl ? '#6bcb77' : '#ffd93d' }}>{rl ? '✓' : '!'}</span>
    : null;

  return (
    <StepCard n={2} title="Rate Limit" statusBadge={badge} open={open} onToggle={onToggle}
      subtitle="Cap how much can be bridged per time window. Adapter only.">
      <Field label="Limit (raw token units)" value={limit} onChange={setLimit} />
      <Field label="Window (seconds)" value={window_} onChange={setWindow} placeholder="3600" />
      <p className="step-hint">Rate limits apply to the adapter only. Set limit to 0 to disable.</p>
      <button className="btn btn-primary" disabled={!isConnected} style={{ marginBottom: 8 }}
        onClick={async () => { setTx({ status: 'pending' }); setTx(await wiring.setRateLimit(adapterAddr, remoteChain.eid, BigInt(limit), Number(window_))); }}>
        Set Rate Limit
      </button>
      {!isConnected && (
        <button className="btn" style={{ marginLeft: 8 }} onClick={() => onSwitchNetwork(remoteChain.chainId)}>
          Switch network
        </button>
      )}
      <TxStatus state={tx} />
    </StepCard>
  );
}

// ── Step 3 — Libraries ────────────────────────────────────────────────────────

function Step3Libraries({ open, onToggle, homeChain, remoteChain, adapterAddr, peerAddr,
  connectedChainId, isConnected, signer, onSwitchNetwork, verifyResult }: {
  open: boolean; onToggle: () => void;
  homeChain: LZChain; remoteChain: LZChain;
  adapterAddr: string; peerAddr: string;
  connectedChainId: number | null; isConnected: boolean;
  signer: JsonRpcSigner | null;
  onSwitchNetwork: (id: number) => void;
  verifyResult: PathwayVerifyResult | null;
}): JSX.Element {
  const epConfig = useEndpointConfig(signer);
  const [sendLib, setSendLib] = useState('');
  const [recvLib, setRecvLib] = useState('');
  const [sendTx, setSendTx] = useState<TxState>({ status: 'idle' });
  const [recvTx, setRecvTx] = useState<TxState>({ status: 'idle' });

  // Pre-fill from verify result if available
  const currentSendLib = verifyResult?.homeSendLib;
  const currentRecvLib = verifyResult?.remoteReceiveLib;
  const badge = verifyResult ? checkBadge(verifyResult.checks, 'Receive library set') : null;

  return (
    <StepCard n={3} title="Message Libraries" statusBadge={badge} open={open} onToggle={onToggle}
      subtitle="Assign explicit send/receive libs on EndpointV2. Defaults work on testnet.">
      {homeChain.isTestnet && (
        <div className="step-info" style={{ marginBottom: 12 }}>
          <span style={{ color: '#6bcb77' }}>✓ Testnet</span> — default libraries are assigned automatically.
          You can still set explicit libs below if needed.
        </div>
      )}

      {currentSendLib && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          Current send lib: <span style={{ color: '#aaa' }}>{currentSendLib}</span>
        </div>
      )}
      {currentRecvLib && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Current receive lib: <span style={{ color: '#aaa' }}>{currentRecvLib}</span>
        </div>
      )}

      <div className="step-actions">
        <div>
          <div className="label" style={{ marginBottom: 8 }}>Send library (home chain — {homeChain.name})</div>
          <Field label="Send lib address (ULN302)" value={sendLib} onChange={setSendLib}
            placeholder={currentSendLib ?? '0x…'} />
          <ChainSwitch label="Requires:" requiredChainId={homeChain.chainId}
            requiredChainName={homeChain.name} connectedChainId={connectedChainId}
            isConnected={isConnected} onSwitch={() => onSwitchNetwork(homeChain.chainId)} />
          <button className="btn btn-primary"
            disabled={!isConnected || connectedChainId !== homeChain.chainId || !sendLib}
            onClick={async () => {
              setSendTx({ status: 'pending' });
              setSendTx(await epConfig.setSendLib(homeChain.endpoint, adapterAddr, remoteChain.eid, sendLib));
            }}>
            Set Send Library
          </button>
          <div style={{ marginTop: 6 }}><TxStatus state={sendTx} /></div>
        </div>
        <div>
          <div className="label" style={{ marginBottom: 8 }}>Receive library (remote chain — {remoteChain.name})</div>
          <Field label="Receive lib address (ULN302)" value={recvLib} onChange={setRecvLib}
            placeholder={currentRecvLib ?? '0x…'} />
          <ChainSwitch label="Requires:" requiredChainId={remoteChain.chainId}
            requiredChainName={remoteChain.name} connectedChainId={connectedChainId}
            isConnected={isConnected} onSwitch={() => onSwitchNetwork(remoteChain.chainId)} />
          <button className="btn btn-primary"
            disabled={!isConnected || connectedChainId !== remoteChain.chainId || !recvLib}
            onClick={async () => {
              setRecvTx({ status: 'pending' });
              setRecvTx(await epConfig.setReceiveLib(remoteChain.endpoint, peerAddr, homeChain.eid, recvLib));
            }}>
            Set Receive Library
          </button>
          <div style={{ marginTop: 6 }}><TxStatus state={recvTx} /></div>
        </div>
      </div>
    </StepCard>
  );
}

// ── Step 4 — DVN & Executor ───────────────────────────────────────────────────

function Step4DVN({ open, onToggle, homeChain, remoteChain, adapterAddr, peerAddr,
  connectedChainId, isConnected, signer, onSwitchNetwork, verifyResult }: {
  open: boolean; onToggle: () => void;
  homeChain: LZChain; remoteChain: LZChain;
  adapterAddr: string; peerAddr: string;
  connectedChainId: number | null; isConnected: boolean;
  signer: JsonRpcSigner | null;
  onSwitchNetwork: (id: number) => void;
  verifyResult: PathwayVerifyResult | null;
}): JSX.Element {
  const epConfig = useEndpointConfig(signer);
  const { dvns: homeDVNs } = useDVNCatalog(homeChain.chainKey);
  const { dvns: remoteDVNs } = useDVNCatalog(remoteChain.chainKey);

  const [selectedHome, setSelectedHome] = useState<Map<string, DVNProvider>>(new Map());
  const [selectedRemote, setSelectedRemote] = useState<Map<string, DVNProvider>>(new Map());
  const [confirmations, setConfirmations] = useState('15');
  const [sendLib, setSendLib] = useState(verifyResult?.homeSendLib ?? '');
  const [recvLib, setRecvLib] = useState(verifyResult?.remoteReceiveLib ?? '');
  const [sendTx, setSendTx] = useState<TxState>({ status: 'idle' });
  const [recvTx, setRecvTx] = useState<TxState>({ status: 'idle' });

  const sendOk = verifyResult?.checks.find((c) => c.label === 'DVNs configured (send side)')?.passed;
  const recvOk = verifyResult?.checks.find((c) => c.label === 'DVNs configured (receive side)')?.passed;
  const badge = verifyResult
    ? <span style={{ fontSize: 11, color: sendOk && recvOk ? '#6bcb77' : '#ff6b6b' }}>{sendOk && recvOk ? '✓' : '✗'}</span>
    : null;

  function toggleHome(addr: string, p: DVNProvider): void {
    setSelectedHome((prev) => {
      const next = new Map(prev);
      if (next.has(addr)) next.delete(addr); else next.set(addr, p);
      return next;
    });
  }

  function toggleRemote(addr: string, p: DVNProvider): void {
    setSelectedRemote((prev) => {
      const next = new Map(prev);
      if (next.has(addr)) next.delete(addr); else next.set(addr, p);
      return next;
    });
  }

  // Resolve current DVN addresses to names for display
  const currentHomeDVNs = verifyResult?.homeDVN?.requiredDVNs ?? [];
  const currentRemoteDVNs = verifyResult?.remoteDVN?.requiredDVNs ?? [];

  function resolveAddr(addr: string, list: DVNProvider[]): string {
    return list.find((d) => d.address.toLowerCase() === addr.toLowerCase())?.name ?? addr.slice(0, 10) + '…';
  }

  return (
    <StepCard n={4} title="DVN & Executor" statusBadge={badge} open={open} onToggle={onToggle}
      subtitle="Configure which providers verify messages and minimum block confirmations.">

      {/* Current status */}
      {verifyResult && (currentHomeDVNs.length > 0 || currentRemoteDVNs.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>Current on-chain DVNs</div>
          <div className="step-actions">
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{homeChain.name} (send)</div>
              {currentHomeDVNs.length === 0
                ? <span style={{ fontSize: 12, color: '#666' }}>None configured</span>
                : currentHomeDVNs.map((addr) => (
                  <DVNChip key={addr} name={resolveAddr(addr, homeDVNs)} addr={addr}
                    color={homeDVNs.find((d) => d.address.toLowerCase() === addr.toLowerCase())?.color ?? '#888'} />
                ))}
              {verifyResult.homeDVN && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  {verifyResult.homeDVN.confirmations.toString()} block confirmations
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{remoteChain.name} (receive)</div>
              {currentRemoteDVNs.length === 0
                ? <span style={{ fontSize: 12, color: '#666' }}>None configured</span>
                : currentRemoteDVNs.map((addr) => (
                  <DVNChip key={addr} name={resolveAddr(addr, remoteDVNs)} addr={addr}
                    color={remoteDVNs.find((d) => d.address.toLowerCase() === addr.toLowerCase())?.color ?? '#888'} />
                ))}
              {verifyResult.remoteDVN && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  {verifyResult.remoteDVN.confirmations.toString()} block confirmations
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shared config params */}
      <div className="form-grid" style={{ marginBottom: 4 }}>
        <Field label="Block confirmations" value={confirmations} onChange={setConfirmations} placeholder="15" />
        <div>
          <div className="label">Executor address</div>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>
            {homeChain.executor ? `Auto-filled from LZ API` : 'Enter manually'}
          </div>
          <input className="input" value={homeChain.executor ?? ''} readOnly
            style={{ color: '#888', fontSize: 12 }} />
        </div>
      </div>
      <p className="step-hint">
        Confirmations: 15 for Ethereum, 1 for Arbitrum/Optimism/Base.
        Executor is chain-specific and pre-filled from the LZ metadata API.
      </p>

      <div className="step-actions" style={{ alignItems: 'start', marginTop: 12 }}>
        {/* Home chain */}
        <div>
          <div className="label" style={{ marginBottom: 6 }}>DVNs — {homeChain.name} (send config)</div>
          <DVNDropdown chainKey={homeChain.chainKey} selected={selectedHome} onToggle={toggleHome} />
          <div style={{ marginTop: 10 }}>
            <Field label="Send lib (from step 3)" value={sendLib} onChange={setSendLib}
              placeholder={homeChain.sendLib ?? verifyResult?.homeSendLib ?? '0x…'} />
            <ChainSwitch label="Requires:" requiredChainId={homeChain.chainId}
              requiredChainName={homeChain.name} connectedChainId={connectedChainId}
              isConnected={isConnected} onSwitch={() => onSwitchNetwork(homeChain.chainId)} />
            <button className="btn btn-primary"
              disabled={!isConnected || connectedChainId !== homeChain.chainId || selectedHome.size === 0 || !(sendLib || homeChain.sendLib || verifyResult?.homeSendLib)}
              onClick={async () => {
                setSendTx({ status: 'pending' });
                const lib = (sendLib || homeChain.sendLib || verifyResult?.homeSendLib) ?? '';
                const dvns = [...selectedHome.values()].map((p) => p.address);
                const exec = homeChain.executor;
                setSendTx(await epConfig.setULNConfig(
                  homeChain.endpoint, adapterAddr, lib, remoteChain.eid,
                  { confirmations: Number(confirmations), requiredDVNs: dvns },
                  exec ? { maxMessageSize: 10000, executor: exec } : undefined,
                ));
              }}>
              Set Send Config
            </button>
            <div style={{ marginTop: 6 }}><TxStatus state={sendTx} /></div>
          </div>
        </div>

        {/* Remote chain */}
        <div>
          <div className="label" style={{ marginBottom: 6 }}>DVNs — {remoteChain.name} (receive config)</div>
          <DVNDropdown chainKey={remoteChain.chainKey} selected={selectedRemote} onToggle={toggleRemote} />
          <div style={{ marginTop: 10 }}>
            <Field label="Receive lib (from step 3)" value={recvLib} onChange={setRecvLib}
              placeholder={remoteChain.receiveLib ?? verifyResult?.remoteReceiveLib ?? '0x…'} />
            <ChainSwitch label="Requires:" requiredChainId={remoteChain.chainId}
              requiredChainName={remoteChain.name} connectedChainId={connectedChainId}
              isConnected={isConnected} onSwitch={() => onSwitchNetwork(remoteChain.chainId)} />
            <button className="btn btn-primary"
              disabled={!isConnected || connectedChainId !== remoteChain.chainId || selectedRemote.size === 0 || !(recvLib || remoteChain.receiveLib || verifyResult?.remoteReceiveLib)}
              onClick={async () => {
                setRecvTx({ status: 'pending' });
                const lib = (recvLib || remoteChain.receiveLib || verifyResult?.remoteReceiveLib) ?? '';
                const dvns = [...selectedRemote.values()].map((p) => p.address);
                setRecvTx(await epConfig.setULNConfig(
                  remoteChain.endpoint, peerAddr, lib, homeChain.eid,
                  { confirmations: Number(confirmations), requiredDVNs: dvns },
                ));
              }}>
              Set Receive Config
            </button>
            <div style={{ marginTop: 6 }}><TxStatus state={recvTx} /></div>
          </div>
        </div>
      </div>
    </StepCard>
  );
}

function DVNChip({ name, addr, color }: { name: string; addr: string; color: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12 }}>{name}</span>
      <span style={{ fontSize: 10, color: '#555' }}>{addr.slice(0, 8)}…</span>
    </div>
  );
}

// ── Step 5 — Set Peers ────────────────────────────────────────────────────────

function Step5Peers({ open, onToggle, homeChain, remoteChain, adapterAddr, peerAddr,
  connectedChainId, isConnected, onSwitchNetwork, wiring, verifyResult }: {
  open: boolean; onToggle: () => void;
  homeChain: LZChain; remoteChain: LZChain;
  adapterAddr: string; peerAddr: string;
  connectedChainId: number | null; isConnected: boolean;
  onSwitchNetwork: (id: number) => void;
  wiring: Wiring; verifyResult: PathwayVerifyResult | null;
}): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [adapterTx, setAdapterTx] = useState<TxState>({ status: 'idle' });
  const [peerTx, setPeerTx] = useState<TxState>({ status: 'idle' });
  const homePeerOk = verifyResult?.checks.find((c) => c.label === 'Peer set (home → remote)')?.passed;
  const remotePeerOk = verifyResult?.checks.find((c) => c.label === 'Peer set (remote → home)')?.passed;
  const badge = verifyResult
    ? <span style={{ fontSize: 11, color: homePeerOk && remotePeerOk ? '#6bcb77' : '#ff6b6b' }}>{homePeerOk && remotePeerOk ? '✓' : '✗'}</span>
    : null;

  return (
    <StepCard n={5} title="Set Peers" statusBadge={badge} open={open} onToggle={onToggle}
      subtitle="Register counterparty addresses. Opens the bridge — do this LAST.">
      <div className="step-warn-banner">
        ⚠ Setting peers opens the messaging channel. Tokens can flow immediately after.
        Ensure steps 1–4 are complete and verified before proceeding.
      </div>
      <div style={{ fontSize: 13, marginTop: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <span className="label">Adapter → Peer</span>
          <div className="mono-block">{peerAddr || '(enter peer address above)'}</div>
        </div>
        <div>
          <span className="label">Peer → Adapter</span>
          <div className="mono-block">{adapterAddr || '(enter adapter address above)'}</div>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0', fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I confirm steps 1–4 are complete and the addresses are correct.
      </label>
      <div className="step-actions">
        <div>
          <ChainSwitch label="Adapter (home):" requiredChainId={homeChain.chainId}
            requiredChainName={homeChain.name} connectedChainId={connectedChainId}
            isConnected={isConnected} onSwitch={() => onSwitchNetwork(homeChain.chainId)} />
          <button className="btn btn-primary"
            disabled={!confirmed || !isConnected || connectedChainId !== homeChain.chainId}
            onClick={async () => { setAdapterTx({ status: 'pending' }); setAdapterTx(await wiring.setEvmPeer(adapterAddr, remoteChain.eid, peerAddr)); }}>
            Set Peer on Adapter
          </button>
          <div style={{ marginTop: 6 }}><TxStatus state={adapterTx} /></div>
        </div>
        <div>
          <ChainSwitch label="Peer (remote):" requiredChainId={remoteChain.chainId}
            requiredChainName={remoteChain.name} connectedChainId={connectedChainId}
            isConnected={isConnected} onSwitch={() => onSwitchNetwork(remoteChain.chainId)} />
          <button className="btn btn-primary"
            disabled={!confirmed || !isConnected || connectedChainId !== remoteChain.chainId}
            onClick={async () => { setPeerTx({ status: 'pending' }); setPeerTx(await wiring.setEvmPeer(peerAddr, homeChain.eid, adapterAddr)); }}>
            Set Peer on Peer contract
          </button>
          <div style={{ marginTop: 6 }}><TxStatus state={peerTx} /></div>
        </div>
      </div>
    </StepCard>
  );
}
