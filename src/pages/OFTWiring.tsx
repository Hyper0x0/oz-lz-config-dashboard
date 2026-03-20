import { useState, useRef, useEffect } from 'react';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useOFTWiring } from '@/hooks/useOFTWiring';
import { useLZVerify } from '@/hooks/useLZVerify';
import { useLZChains } from '@/hooks/useLZChains';
import { EvmWalletButton } from '@/components/EvmWalletButton';
import { GuidedConfigure } from '@/components/GuidedConfigure';
import { CONTRACTS } from '@/config/chains';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import type { LZChain } from '@/config/lzCatalog';
import type { PathwayVerifyResult, TokenInfo } from '@/types';

type Tab = 'verify' | 'configure';

export function OFTWiring(): JSX.Element {
  const evm = useEvmWallet();
  const wiring = useOFTWiring(evm.signer);
  const { verify } = useLZVerify();
  const { chains, loading: chainsLoading, isTestnet, setIsTestnet } = useLZChains(true);

  // Chain selection — keep in sync with chains list
  const [homeChain, setHomeChain] = useState<LZChain | null>(null);
  const [remoteChain, setRemoteChain] = useState<LZChain | null>(null);

  // Resolve selected chains (fallback to first/second in list)
  const home: LZChain = homeChain ?? chains[0] ?? { eid: 0, chainId: 0, name: '', chainKey: '', endpoint: '', rpc: '', isTestnet: true };
  const remote: LZChain = remoteChain ?? chains[1] ?? home;

  // Contract addresses
  const [adapterAddr, setAdapterAddr] = useState(CONTRACTS.adapter);
  const [peerAddr, setPeerAddr] = useState(CONTRACTS.peer);

  // Tab
  const [tab, setTab] = useState<Tab>('verify');

  // Token info
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenInfoError, setTokenInfoError] = useState<string | null>(null);

  // Verify state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<PathwayVerifyResult | null>(null);
  const [fetching, setFetching] = useState(false);

  function clearData(): void {
    setVerifyResult(null);
    setTokenInfo(null);
    setTokenInfoError(null);
  }

  function handleNetworkToggle(testnet: boolean): void {
    setIsTestnet(testnet);
    setHomeChain(null);
    setRemoteChain(null);
    clearData();
  }

  function handleHomeChain(eid: number): void {
    const c = chains.find((x) => x.eid === eid);
    if (c) { setHomeChain(c); clearData(); }
  }

  function handleRemoteChain(eid: number): void {
    const c = chains.find((x) => x.eid === eid);
    if (c) { setRemoteChain(c); clearData(); }
  }

  function walletProviderForHome() {
    return evm.provider && evm.chainId === home.chainId ? evm.provider : undefined;
  }

  async function handleFetch(): Promise<void> {
    setFetching(true);
    clearData();
    const walletProvider = walletProviderForHome();
    const [tokenResult, verifyRes] = await Promise.allSettled([
      wiring.readTokenInfo(adapterAddr, peerAddr, home.rpc, remote.rpc, walletProvider),
      verify({ adapterAddr, peerAddr, homeChain: home, remoteChain: remote, walletProvider }),
    ]);
    if (tokenResult.status === 'fulfilled') {
      setTokenInfo(tokenResult.value);
    } else {
      setTokenInfoError(tokenResult.reason instanceof Error ? tokenResult.reason.message : String(tokenResult.reason));
    }
    if (verifyRes.status === 'fulfilled') setVerifyResult(verifyRes.value);
    setFetching(false);
  }

  async function handleVerify(): Promise<void> {
    setVerifying(true);
    setVerifyResult(null);
    const result = await verify({ adapterAddr, peerAddr, homeChain: home, remoteChain: remote, walletProvider: walletProviderForHome() });
    setVerifyResult(result);
    setVerifying(false);
  }

  return (
    <div>
      <div className="topbar">
        <h2>OFT Wiring</h2>
        <EvmWalletButton
          address={evm.address}
          chainId={evm.chainId}
          chainName={home.name}
          onConnect={evm.connect}
          onSwitchNetwork={() => evm.switchNetwork(home.chainId)}
          targetChainId={home.chainId}
        />
      </div>

      {/* Chain + contract picker */}
      <section className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <button className={`btn${isTestnet ? '' : ' btn-ghost'}`} onClick={() => handleNetworkToggle(true)}>Testnet</button>
          <button className={`btn${!isTestnet ? '' : ' btn-ghost'}`} onClick={() => handleNetworkToggle(false)}>Mainnet</button>
          {chainsLoading && <span style={{ fontSize: 12, color: '#888' }}>Loading chains…</span>}
          {!chainsLoading && <span style={{ fontSize: 12, color: '#555' }}>{chains.length} chains</span>}
        </div>

        <div className="form-grid">
          <div>
            <div className="label">Home chain (adapter / sender) — EID {home.eid}</div>
            <ChainSelect chains={chains} selected={home} onSelect={(c) => { setHomeChain(c); clearData(); }} />
          </div>
          <div>
            <div className="label">Remote chain (peer / receiver) — EID {remote.eid}</div>
            <ChainSelect chains={chains} selected={remote} onSelect={(c) => { setRemoteChain(c); clearData(); }} />
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: 8 }}>
          <Field label="Adapter address (home)" value={adapterAddr} onChange={setAdapterAddr} />
          <Field label="Peer address (remote)" value={peerAddr} onChange={setPeerAddr} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button className="btn btn-primary" onClick={handleFetch} disabled={fetching || !adapterAddr || !peerAddr || !home.eid}>
            {fetching ? 'Fetching…' : 'Fetch data'}
          </button>
          {evm.isConnected && evm.chainId === home.chainId && (
            <span style={{ fontSize: 12, color: '#6bcb77' }}>✓ Using wallet RPC ({home.name})</span>
          )}
          {evm.isConnected && evm.chainId !== home.chainId && (
            <span style={{ fontSize: 12, color: '#888' }}>Using public RPC — connect wallet to {home.name} for its RPC</span>
          )}
        </div>

        {/* Token info banner */}
        {tokenInfo && (
          <div className="token-banner">
            <TokenBadge label="Adapter locks" name={tokenInfo.tokenName} symbol={tokenInfo.tokenSymbol} />
            <span style={{ color: '#444', fontSize: 18 }}>↔</span>
            <TokenBadge label="Peer mints" name={tokenInfo.peerName} symbol={tokenInfo.peerSymbol} />
          </div>
        )}
        {tokenInfoError && (
          <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 8 }}>Could not read token names: {tokenInfoError}</div>
        )}
      </section>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className={`btn${tab === 'verify' ? '' : ' btn-ghost'}`} onClick={() => setTab('verify')}>Verify</button>
        <button className={`btn${tab === 'configure' ? '' : ' btn-ghost'}`} onClick={() => setTab('configure')}>Configure</button>
      </div>

      {tab === 'verify' && (
        <VerifyPanel
          homeChain={home}
          remoteChain={remote}
          verifying={verifying}
          result={verifyResult}
          onVerify={handleVerify}
        />
      )}

      {tab === 'configure' && (
        <GuidedConfigure
          homeChain={home}
          remoteChain={remote}
          adapterAddr={adapterAddr}
          peerAddr={peerAddr}
          connectedChainId={evm.chainId}
          isConnected={evm.isConnected}
          signer={evm.signer}
          onSwitchNetwork={evm.switchNetwork}
          wiring={wiring}
          verifyResult={verifyResult}
        />
      )}

      <section className="card card-wip" style={{ marginTop: 16 }}>
        <h3>EVM ↔ Cairo (Starknet) — WIP</h3>
        <p style={{ color: '#888', fontSize: 13 }}>Cairo OFT contracts not yet deployed. Wire once contracts are ready.</p>
      </section>
    </div>
  );
}

// ── Searchable chain dropdown ─────────────────────────────────────────────────

function ChainSelect({ chains, selected, onSelect }: {
  chains: LZChain[];
  selected: LZChain;
  onSelect: (c: LZChain) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setQuery('');
  }, [open]);

  const q = query.toLowerCase();
  const filtered = chains.filter(
    (c) => c.name.toLowerCase().includes(q) || String(c.eid).includes(q)
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="input"
        style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span>{selected.name} — EID {selected.eid}</span>
        <span style={{ color: '#555', fontSize: 11, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="chain-dropdown">
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #2a2a2a' }}>
            <input
              ref={inputRef}
              className="input"
              placeholder="Search by name or EID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ padding: '5px 8px' }}
            />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 240 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', color: '#555', fontSize: 13 }}>No chains match</div>
            )}
            {filtered.map((c) => (
              <div
                key={c.eid}
                className={`chain-option${c.eid === selected.eid ? ' chain-option-active' : ''}`}
                onClick={() => { onSelect(c); setOpen(false); }}
              >
                <span>{c.name}</span>
                <span style={{ color: '#555', fontSize: 11 }}>EID {c.eid}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Token banner ──────────────────────────────────────────────────────────────

function TokenBadge({ label, name, symbol }: { label: string; name: string; symbol: string }): JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="label" style={{ marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{symbol}</div>
      <div style={{ fontSize: 12, color: '#888' }}>{name}</div>
    </div>
  );
}

// ── Verify panel ──────────────────────────────────────────────────────────────

function VerifyPanel({ homeChain, remoteChain, verifying, result, onVerify }: {
  homeChain: LZChain; remoteChain: LZChain;
  verifying: boolean; result: PathwayVerifyResult | null;
  onVerify: () => void;
}): JSX.Element {
  const { resolveName: resolveHome } = useDVNCatalog(homeChain.chainKey);
  const { resolveName: resolveRemote } = useDVNCatalog(remoteChain.chainKey);

  function dvnLabel(addr: string, resolver: (a: string) => string | null): string {
    const name = resolver(addr);
    return name ? `${name} (${addr.slice(0, 8)}…${addr.slice(-4)})` : addr;
  }

  // Replace any 0x addresses in a detail string with resolved names
  function resolveDetail(detail: string): string {
    return detail.replace(/0x[0-9a-fA-F]{40}/g, (addr) => {
      const name = resolveHome(addr) ?? resolveRemote(addr);
      return name ? `${name} (${addr.slice(0, 8)}…)` : addr;
    });
  }

  const criticalFailed = result?.checks.filter((c) => !c.passed && c.severity === 'critical') ?? [];
  const warnFailed = result?.checks.filter((c) => !c.passed && c.severity === 'warning') ?? [];
  const passed = result?.checks.filter((c) => c.passed) ?? [];

  return (
    <section className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Pathway verification</h3>
          <span style={{ color: '#888', fontSize: 13 }}>
            {homeChain.name} (EID {homeChain.eid}) → {remoteChain.name} (EID {remoteChain.eid})
          </span>
        </div>
        <button className="btn" onClick={onVerify} disabled={verifying}>
          {verifying ? 'Checking…' : 'Run checks'}
        </button>
      </div>

      {!result && !verifying && (
        <p style={{ color: '#666', fontSize: 13 }}>
          Press <strong>Run checks</strong> to read on-chain config from both endpoints.
        </p>
      )}

      {result?.error && (
        <div className="check-row check-critical"><span>RPC error: {result.error}</span></div>
      )}

      {result && !result.error && (
        <>
          {/* Compact config summary */}
          <div className="verify-summary">
            <SummaryItem label="Executor" value={result.homeExecutor?.executor ?? '—'} />
            <SummaryItem label="Max msg size" value={result.homeExecutor ? `${result.homeExecutor.maxMessageSize} bytes` : '—'} />
            <SummaryItem label="Send lib" value={result.homeSendLib ?? '—'} />
            <SummaryItem label="Recv lib" value={result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : '—'} />
            <SummaryItem label="Confirmations" value={result.homeDVN ? `${result.homeDVN.confirmations} blocks` : '—'} />
            {result.homeRateLimit !== undefined && (
              <SummaryItem label="Rate limit" value={result.homeRateLimit ? `${String(result.homeRateLimit.limit)} / ${result.homeRateLimit.window}s` : 'disabled'} />
            )}
          </div>

          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 12, margin: '12px 0', fontSize: 13 }}>
            {criticalFailed.length > 0 && <span style={{ color: '#ff6b6b' }}>{criticalFailed.length} critical</span>}
            {warnFailed.length > 0 && <span style={{ color: '#ffd93d' }}>{warnFailed.length} warning{warnFailed.length > 1 ? 's' : ''}</span>}
            {criticalFailed.length === 0 && warnFailed.length === 0 && <span style={{ color: '#6bcb77' }}>All checks passed</span>}
            <span style={{ color: '#555' }}>{passed.length}/{result.checks.length} passed</span>
          </div>

          {result.checks.map((c, i) => (
            <div key={i} className={`check-row ${c.passed ? 'check-pass' : c.severity === 'critical' ? 'check-critical' : c.severity === 'warning' ? 'check-warn' : 'check-info'}`}>
              <span className="check-icon">{c.passed ? '✓' : c.severity === 'critical' ? '✗' : c.severity === 'warning' ? '!' : 'i'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 12, opacity: 0.8, wordBreak: 'break-all' }}>{resolveDetail(c.detail)}</div>
              </div>
            </div>
          ))}

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: '#888', fontSize: 13 }}>Raw values</summary>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <RawSection title={`${homeChain.name} — send side`}>
                <RawRow label="EID" value={String(homeChain.eid)} />
                <RawRow label="Send library" value={result.homeSendLib} />
                <RawRow label="Executor" value={result.homeExecutor?.executor} />
                <RawRow label="Max msg size" value={result.homeExecutor ? `${result.homeExecutor.maxMessageSize} bytes` : null} />
                <RawRow label="DVNs (required)" value={result.homeDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveHome)).join('\n') ?? null} />
                <RawRow label="Confirmations" value={result.homeDVN?.confirmations != null ? String(result.homeDVN.confirmations) : null} />
                <RawRow label="Enforced options" value={result.homeEnforcedOptions} />
                <RawRow label="Peer bytes32" value={result.homePeer} />
                <RawRow label="Delegate" value={result.homeDelegate} />
                {result.homeRateLimit !== undefined && (
                  <RawRow label="Rate limit" value={result.homeRateLimit ? `${String(result.homeRateLimit.limit)} / ${result.homeRateLimit.window}s` : 'none'} />
                )}
              </RawSection>
              <RawSection title={`${remoteChain.name} — receive side`}>
                <RawRow label="EID" value={String(remoteChain.eid)} />
                <RawRow label="Receive library" value={result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : null} />
                <RawRow label="DVNs (required)" value={result.remoteDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveRemote)).join('\n') ?? null} />
                <RawRow label="Confirmations" value={result.remoteDVN?.confirmations != null ? String(result.remoteDVN.confirmations) : null} />
                <RawRow label="Enforced options" value={result.remoteEnforcedOptions} />
                <RawRow label="Peer bytes32" value={result.remotePeer} />
              </RawSection>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="label" style={{ marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, wordBreak: 'break-all', color: value === '—' ? '#444' : '#ccc' }}>{value}</div>
    </div>
  );
}

function RawSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: '#aaa', marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function RawRow({ label, value }: { label: string; value: string | null | undefined }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
      <span style={{ color: '#666', minWidth: 140 }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{value ?? '—'}</span>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  );
}
