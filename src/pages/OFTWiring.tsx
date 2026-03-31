import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useOFTWiring } from '@/hooks/useOFTWiring';
import { useLZVerify } from '@/hooks/useLZVerify';
import { useLZChains } from '@/hooks/useLZChains';
import { useCairoOFT } from '@/hooks/useCairoOFT';
import { useCairoEndpoint } from '@/hooks/useCairoEndpoint';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { TxStatus } from '@/components/TxStatus';
import { GuidedConfigure } from '@/components/GuidedConfigure';
import { CONTRACTS, STARKNET_TESTNET, STARKNET_MAINNET } from '@/config/chains';
import type { AnyChain, LZChain, StarknetChain } from '@/config/lzCatalog';
import { isStarknet, isEvm } from '@/config/lzCatalog';
import type { PathwayVerifyResult, TokenInfo, TxState, PeerEntry, DVNProvider } from '@/types';
import { sortDvns } from '@/utils/cairoLzConfig';

type Tab = 'verify' | 'configure';
type WiringMode = 'bridge-oft' | 'oft-oft';

/** Returns false for '', '0x', or any string that would throw BigInt(). */
function isAddr(s: string): boolean { return s.length > 2 && s !== '0x'; }
/** Safe bytes32 display from a hex address string. */
function addrToBytes32(addr: string): string { return '0x' + BigInt(addr).toString(16).padStart(64, '0'); }

function toAnyEvm(c: LZChain): AnyChain { return { ...c, kind: 'evm' }; }
function starkChain(testnet: boolean): StarknetChain {
  const base = testnet ? STARKNET_TESTNET : STARKNET_MAINNET;
  // Apply RPC override from settings (stored in localStorage)
  try {
    const stored = localStorage.getItem('ozlz_rpc_overrides');
    if (stored) {
      const overrides = JSON.parse(stored) as { starknetMainnet?: string; starknetSepolia?: string };
      const override = testnet ? overrides.starknetSepolia : overrides.starknetMainnet;
      if (override?.trim()) return { kind: 'starknet', isTestnet: testnet, ...base, rpc: override.trim() };
    }
  } catch { /* ignore */ }
  return { kind: 'starknet', isTestnet: testnet, ...base };
}

export function OFTWiring(): JSX.Element {
  const { evm, stark } = useWallet();
  const { chains: evmChains, loading: chainsLoading, isTestnet, setIsTestnet } = useLZChains(true);
  const wiring = useOFTWiring(evm.signer);
  const { verify, readEvmSideForStarknet } = useLZVerify();
  const cairo = useCairoOFT(stark.account);
  const cairoEndpoint = useCairoEndpoint(stark.account);

  // Chain selection
  const [homeChain, setHomeChain] = useState<AnyChain | null>(null);
  const [remoteChain, setRemoteChain] = useState<AnyChain | null>(null);

  const defaultEvm0 = evmChains[0] ?? { eid: 0, chainId: 0, name: '', chainKey: '', endpoint: '', rpc: '', isTestnet: true } as LZChain;
  const defaultEvm1 = evmChains[1] ?? defaultEvm0;
  const home: AnyChain = homeChain ?? toAnyEvm(defaultEvm0);
  const remote: AnyChain = remoteChain ?? toAnyEvm(defaultEvm1);

  // Wiring mode
  const [mode, setMode] = useState<WiringMode>('bridge-oft');

  // Contract addresses
  const [homeAddr, setHomeAddr] = useState(CONTRACTS.adapter);
  const [remoteAddr, setRemoteAddr] = useState(CONTRACTS.peer);

  // Tab
  const [tab, setTab] = useState<Tab>('verify');

  // EVM-EVM state
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenInfoError, setTokenInfoError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<PathwayVerifyResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const [starkFetchTick, setStarkFetchTick] = useState(0);

  const bothEvm = isEvm(home) && isEvm(remote);
  const hasStarknet = isStarknet(home) || isStarknet(remote);
  const evmHome: LZChain | null = isEvm(home) ? home : null;
  const evmRemote: LZChain | null = isEvm(remote) ? remote : null;

  // Peer map sidebar
  const [peers, setPeers] = useState<PeerEntry[] | null>(null);
  const [peersScanning, setPeersScanning] = useState(false);
  const [peersError, setPeersError] = useState<string | null>(null);

  const starkHome = isStarknet(home) ? home : null;
  const canScanPeers = !!homeAddr && homeAddr !== '0x' && (!!evmHome || !!starkHome);

  async function handleScanPeers(): Promise<void> {
    if (!canScanPeers) return;
    setPeersScanning(true);
    setPeers(null);
    setPeersError(null);
    try {
      const starkEntry = { eid: starkChain(isTestnet).eid, name: starkChain(isTestnet).name };
      if (evmHome) {
        // EVM home: call peers(eid) on the EVM adapter for all other EVM chains + Starknet
        const evmEntries = evmChains
          .filter((c) => c.eid !== evmHome.eid)
          .map((c) => ({ eid: c.eid, name: c.name }));
        const result = await wiring.readAllPeers(homeAddr, evmHome.rpc, [...evmEntries, starkEntry]);
        setPeers(result);
      } else if (starkHome) {
        // Starknet home: call get_peer(eid) on the Cairo OFT for all EVM chains
        const evmEntries = evmChains
          .map((c) => ({ eid: c.eid, name: c.name }));
        const result = await cairo.readAllPeers(homeAddr, evmEntries, starkHome.rpc);
        setPeers(result);
      }
    } catch (e) {
      setPeersError(e instanceof Error ? e.message : String(e));
    }
    setPeersScanning(false);
  }

  const homeLabel = mode === 'bridge-oft' ? 'Adapter' : 'OFT';

  function clearData() {
    setVerifyResult(null);
    setTokenInfo(null);
    setTokenInfoError(null);
  }

  function handleNetworkToggle(testnet: boolean) {
    setIsTestnet(testnet);
    setHomeChain(null);
    setRemoteChain(null);
    clearData();
  }

  function walletProviderForHome() {
    if (!evmHome) return undefined;
    return evm.provider && evm.chainId === evmHome.chainId ? evm.provider : undefined;
  }

  async function handleFetch(): Promise<void> {
    setFetching(true);
    clearData();

    if (bothEvm && evmHome && evmRemote) {
      // Full EVM↔EVM fetch: token info + verify
      const wp = walletProviderForHome();
      const [tokenResult, verifyRes] = await Promise.allSettled([
        wiring.readTokenInfo(homeAddr, remoteAddr, evmHome.rpc, evmRemote.rpc, wp),
        verify({ adapterAddr: homeAddr, peerAddr: remoteAddr, homeChain: evmHome, remoteChain: evmRemote, walletProvider: wp }),
      ]);
      if (tokenResult.status === 'fulfilled') setTokenInfo(tokenResult.value);
      else setTokenInfoError('Could not read token names: ' + (tokenResult.reason instanceof Error ? tokenResult.reason.message : String(tokenResult.reason)));
      if (verifyRes.status === 'fulfilled') setVerifyResult(verifyRes.value);
    } else if (hasStarknet) {
      // Starknet combination: trigger peer checks in StarknetVerifyPanel
      setTab('verify');
      setStarkFetchTick((t) => t + 1);
    }

    setFetching(false);
  }

  async function handleVerify(): Promise<void> {
    if (!bothEvm || !evmHome || !evmRemote) return;
    setVerifying(true);
    setVerifyResult(null);
    const result = await verify({ adapterAddr: homeAddr, peerAddr: remoteAddr, homeChain: evmHome, remoteChain: evmRemote, walletProvider: walletProviderForHome() });
    setVerifyResult(result);
    setVerifying(false);
  }

  // Auto-run EVM verify (debounced) when addresses or chains change
  const autoVerifyTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!bothEvm || !isAddr(homeAddr) || !isAddr(remoteAddr)) return;
    clearTimeout(autoVerifyTimer.current);
    autoVerifyTimer.current = setTimeout(() => { void handleVerify(); }, 1500);
    return () => clearTimeout(autoVerifyTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeAddr, remoteAddr, home.eid, remote.eid, bothEvm]);

  return (
    <div className="grid grid-cols-12 gap-6">

      {/* ── Left: main content ── */}
      <div className="col-span-12 lg:col-span-8 space-y-6">

        {/* Pathway Configuration */}
        <section className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-lg">route</span>
            </div>
            <div>
              <h3 className="font-headline text-base font-bold text-on-surface">Pathway Configuration</h3>
              <p className="text-[11px] text-on-surface-variant">Select chains and contract addresses</p>
            </div>
          </div>

          {/* Network toggle + wiring mode */}
          <div className="flex gap-2 items-center mb-5 flex-wrap">
            <button
              className={`px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${isTestnet ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
              onClick={() => handleNetworkToggle(true)}>Testnet</button>
            <button
              className={`px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${!isTestnet ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
              onClick={() => handleNetworkToggle(false)}>Mainnet</button>
            {chainsLoading && <span className="text-xs text-on-surface-variant">Loading chains…</span>}
            {!chainsLoading && <span className="text-xs text-on-surface-variant">{evmChains.length} EVM + 1 Starknet</span>}
            <div className="ml-auto flex gap-2 items-center">
              <span className="text-xs text-on-surface-variant">Wire:</span>
              <button
                className={`px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${mode === 'bridge-oft' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
                onClick={() => setMode('bridge-oft')}>Adapter ↔ OFT</button>
              <button
                className={`px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${mode === 'oft-oft' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
                onClick={() => setMode('oft-oft')}>OFT ↔ OFT</button>
            </div>
          </div>

          {/* Chain selectors */}
          <div className="form-grid">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">{homeLabel} chain (home) — EID {home.eid}</div>
              <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={home}
                onSelect={(c) => { setHomeChain(c); clearData(); setTab('verify'); }} />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">OFT chain (remote) — EID {remote.eid}</div>
              <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={remote}
                onSelect={(c) => { setRemoteChain(c); clearData(); setTab('verify'); }} />
            </div>
          </div>

          {/* Address inputs */}
          <div className="form-grid mt-3">
            <Field label={`${homeLabel} address (home)`} value={homeAddr} onChange={setHomeAddr} />
            <Field label="OFT address (remote)" value={remoteAddr} onChange={setRemoteAddr} />
          </div>

          {/* Fetch + wallet hints */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {(bothEvm || hasStarknet) && (
              <button
                className="btn btn-primary"
                onClick={handleFetch}
                disabled={fetching || !homeAddr || !remoteAddr}
              >
                {fetching ? 'Fetching…' : 'Fetch data'}
              </button>
            )}
            {evmHome && evm.isConnected && evm.chainId === evmHome.chainId && (
              <span className="flex items-center gap-1.5 text-xs text-secondary"><span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>EVM wallet on {evmHome.name}</span>
            )}
            {evmHome && evm.isConnected && evm.chainId !== evmHome.chainId && (
              <span className="text-xs text-on-surface-variant">Using public RPC — switch wallet to {evmHome.name} to configure</span>
            )}
            {hasStarknet && stark.isConnected && (
              <span className="flex items-center gap-1.5 text-xs text-secondary"><span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>Starknet wallet connected</span>
            )}
            {hasStarknet && !stark.isConnected && (
              <span className="text-xs text-on-surface-variant">Connect Starknet wallet to configure</span>
            )}
          </div>

          {/* Token banner (EVM-EVM only) */}
          {tokenInfo && (
            <div className="token-banner">
              <TokenBadge label={`${homeLabel} locks`} name={tokenInfo.tokenName} symbol={tokenInfo.tokenSymbol} />
              <span style={{ color: '#444', fontSize: 18 }}>↔</span>
              <TokenBadge label="OFT mints" name={tokenInfo.peerName} symbol={tokenInfo.peerSymbol} />
            </div>
          )}
          {tokenInfoError && (
            <div className="text-xs text-error mt-3">{tokenInfoError}</div>
          )}
        </section>

        {/* Verify + Configure tabs — shown for all chain combinations */}
        {(bothEvm || hasStarknet) && (
          <>
            <div className="flex gap-2 mb-1">
              <button
                className={`px-4 py-2 rounded text-xs font-headline font-bold transition-colors ${tab === 'verify' ? 'bg-surface-container-high text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                onClick={() => setTab('verify')}>Verify</button>
              <button
                className={`px-4 py-2 rounded text-xs font-headline font-bold transition-colors ${tab === 'configure' ? 'bg-surface-container-high text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                onClick={() => setTab('configure')}>Configure</button>
            </div>
            {tab === 'verify' && bothEvm && evmHome && evmRemote && (
              <VerifyPanel homeChain={evmHome} remoteChain={evmRemote} verifying={verifying} result={verifyResult} onVerify={handleVerify} isAdapter={mode === 'bridge-oft'} />
            )}
            {tab === 'verify' && hasStarknet && (
              <StarknetVerifyPanel
                home={home} remote={remote}
                homeAddr={homeAddr} remoteAddr={remoteAddr}
                cairo={cairo} cairoEndpoint={cairoEndpoint}
                readEvmSide={readEvmSideForStarknet}
                fetchTick={starkFetchTick}
              />
            )}
            {tab === 'configure' && bothEvm && evmHome && evmRemote && (
              <EvmEvmConfigurePanel
                homeChain={evmHome} remoteChain={evmRemote}
                homeAddr={homeAddr} remoteAddr={remoteAddr}
                mode={mode} evm={evm} wiring={wiring} verifyResult={verifyResult}
              />
            )}
            {tab === 'configure' && hasStarknet && (
              <StarknetConfigurePanel
                home={home} remote={remote}
                homeAddr={homeAddr} remoteAddr={remoteAddr}
                wiringMode={mode}
                stark={stark} cairo={cairo} cairoEndpoint={cairoEndpoint} wiring={wiring}
                evm={evm} verifyResult={verifyResult}
              />
            )}
          </>
        )}
      </div>{/* end left column */}

      {/* Right sidebar: Connected Peers */}
      <div className="col-span-12 lg:col-span-4">
        <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-6 sticky top-6">
          <PeersSidebar
            peers={peers}
            scanning={peersScanning}
            error={peersError}
            canScan={canScanPeers}
            bridgeAddr={homeAddr}
            bridgeLabel={isStarknet(home) ? 'Cairo OFT' : homeLabel}
            chainName={home.name}
            isTestnet={isTestnet}
            onScan={handleScanPeers}
          />
        </div>
      </div>

    </div>
  );
}

// ── DVN icon with initials fallback ──────────────────────────────────────────

function DVNIcon({ provider, size = 22 }: { provider: DVNProvider; size?: number }): JSX.Element {
  const initials = provider.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const [failed, setFailed] = useState(false);
  if (provider.icon && !failed) {
    return (
      <img src={provider.icon} alt={provider.name} width={size} height={size}
        onError={() => setFailed(true)}
        style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%',
      background: provider.color + '33', border: `1px solid ${provider.color}`,
      color: provider.color, fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
    }}>{initials}</span>
  );
}

// ── Chain icon helpers ────────────────────────────────────────────────────────

/**
 * Return a DeFiLlama chain icon URL for a given chainKey.
 * Strips testnet suffixes and normalises to DeFiLlama naming.
 */
function chainIconUrl(chainKey: string): string {
  const base = chainKey
    .replace(/-sepolia$/i, '')
    .replace(/-testnet$/i, '')
    .replace(/-goerli$/i, '')
    .replace(/-fuji$/i, '')
    .replace(/-mumbai$/i, '')
    .replace(/-nova$/i, '-nova')  // keep arbitrum-nova as-is
    .toLowerCase();
  // Map LZ chainKeys to DeFiLlama chain slugs where they differ
  const overrides: Record<string, string> = {
    'ethereum':   'ethereum',
    'bsc':        'bsc',
    'avalanche':  'avax',
    'polygon':    'polygon',
    'fantom':     'fantom',
    'gnosis':     'xdai',
    'cronos':     'cronos',
    'celo':       'celo',
    'moonbeam':   'moonbeam',
    'moonriver':  'moonriver',
    'harmony':    'harmony',
    'kava':       'kava',
    'aurora':     'aurora',
    'telos':      'telos',
    'zksync':     'era',
    'polygon-zkevm': 'polygon%20zkevm',
  };
  return `https://icons.llamao.fi/icons/chains/rsz_${overrides[base] ?? base}.jpg`;
}

function ChainIconFallback({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}
      xmlns="http://www.w3.org/2000/svg">
      <rect width="18" height="18" rx="9" fill="#1e1e2e" />
      {/* cube / block icon — hexagon outer + 3 lines from center to alternating vertices */}
      <path d="M9 3.5 L14 6.5 L14 11.5 L9 14.5 L4 11.5 L4 6.5 Z" stroke="#6c6c8a" strokeWidth="1" fill="none" />
      <path d="M9 9 L9 3.5 M9 9 L14 11.5 M9 9 L4 11.5" stroke="#6c6c8a" strokeWidth="1" fill="none" />
    </svg>
  );
}

function ChainIcon({ chainKey, size = 18 }: { chainKey: string; size?: number }): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) return <ChainIconFallback size={size} />;
  return (
    <img src={chainIconUrl(chainKey)} alt="" width={size} height={size}
      onError={() => setFailed(true)}
      style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
  );
}

// ── Chain category helpers ────────────────────────────────────────────────────

function chainCategory(c: LZChain): 'L1' | 'L2' {
  const n = c.name.toLowerCase();
  const k = c.chainKey.toLowerCase();
  if (
    n.includes('arbitrum') || n.includes('optimism') || n.includes('base') ||
    n.includes('zksync') || n.includes('linea') || n.includes('scroll') ||
    n.includes('blast') || n.includes('mode') || n.includes('mantle') ||
    n.includes('taiko') || n.includes('polygon zk') || n.includes('manta') ||
    n.includes('zircuit') || n.includes('kroma') || n.includes('mint') ||
    k.includes('op-') || k.includes('arb') || k.includes('zk') || k.includes('l2')
  ) return 'L2';
  return 'L1';
}

// ── Unified chain select (EVM + Starknet) ────────────────────────────────────

function AnyChainSelect({ evmChains, isTestnet, selected, onSelect }: {
  evmChains: LZChain[];
  isTestnet: boolean;
  selected: AnyChain;
  onSelect: (c: AnyChain) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stark = starkChain(isTestnet);

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

  const q = query.toLowerCase();
  const filteredEvm = evmChains.filter(
    (c) => c.name.toLowerCase().includes(q) || String(c.eid).includes(q)
  );

  const isSelectedStark = isStarknet(selected);
  const selectedChainKey = isSelectedStark ? '' : (selected as LZChain).chainKey;
  const displayName = `${selected.name} — EID ${selected.eid}`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="input"
        style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
          ...(isSelectedStark ? { borderColor: '#2a2a5a', color: '#919bff' } : {}) }}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isSelectedStark
            ? <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#919bff22', border: '1px solid #919bff55', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#919bff', fontWeight: 700 }}>SN</span>
            : <ChainIcon chainKey={selectedChainKey} size={18} />
          }
          {displayName}
        </span>
        <span style={{ color: '#555', fontSize: 11, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="chain-dropdown">
          {/* Starknet option pinned at top */}
          <div
            className={`chain-option${isSelectedStark ? ' chain-option-active' : ''}`}
            style={{ borderBottom: '1px solid #2a2a2a', color: isSelectedStark ? '#919bff' : '#919bff88', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={() => { onSelect(stark); setOpen(false); }}
          >
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#919bff22', border: '1px solid #919bff55', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#919bff', fontWeight: 700 }}>SN</span>
            <span>{stark.name}</span>
            <span style={{ fontSize: 11, marginLeft: 'auto' }}>EID {stark.eid}</span>
          </div>

          {/* Search + EVM list */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #2a2a2a' }}>
            <input
              ref={inputRef}
              className="input"
              placeholder="Search EVM chain by name or EID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ padding: '5px 8px' }}
            />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 260 }}>
            {filteredEvm.length === 0 && (
              <div style={{ padding: '10px 12px', color: '#555', fontSize: 13 }}>No chains match</div>
            )}
            {(['L1', 'L2'] as const).map((cat) => {
              const group = filteredEvm.filter((c) => chainCategory(c) === cat);
              if (group.length === 0) return null;
              return (
                <div key={cat}>
                  <div style={{ padding: '5px 12px 2px', fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#444' }}>{cat}</div>
                  {group.map((c) => (
                    <div
                      key={c.eid}
                      className={`chain-option${!isSelectedStark && (selected as LZChain).eid === c.eid ? ' chain-option-active' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      onClick={() => { onSelect(toAnyEvm(c)); setOpen(false); }}
                    >
                      <ChainIcon chainKey={c.chainKey} size={18} />
                      <span>{c.name}</span>
                      <span style={{ color: '#555', fontSize: 11, marginLeft: 'auto' }}>EID {c.eid}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Starknet verify panel ─────────────────────────────────────────────────────

type EvmSideState = Awaited<ReturnType<ReturnType<typeof useLZVerify>['readEvmSideForStarknet']>>;

interface StarkSideState {
  sendLib: string | null;
  recvLib: string | null;
  recvLibIsDefault: boolean;
  delegate: string | null;
  enforcedOptions: boolean;
  peer: string | null;
}

function CheckRow({ label, passed, detail, severity = 'critical' }: {
  label: string; passed: boolean; detail?: string; severity?: 'critical' | 'warning';
}): JSX.Element {
  const cls = passed ? 'check-pass' : severity === 'warning' ? 'check-warn' : 'check-critical';
  return (
    <div className={`check-row ${cls}`}>
      <span className="check-icon">{passed ? '✓' : '✗'}</span>
      <div className="flex-1">
        <div className="font-semibold">{label}</div>
        {detail && <div className="text-xs opacity-80 break-all">{detail}</div>}
      </div>
    </div>
  );
}

function StarknetVerifyPanel({ home, remote, homeAddr, remoteAddr, cairo, cairoEndpoint, readEvmSide, fetchTick }: {
  home: AnyChain; remote: AnyChain;
  homeAddr: string; remoteAddr: string;
  cairo: ReturnType<typeof useCairoOFT>;
  cairoEndpoint: ReturnType<typeof useCairoEndpoint>;
  readEvmSide: ReturnType<typeof useLZVerify>['readEvmSideForStarknet'];
  fetchTick?: number;
}): JSX.Element {
  const starkChainData = (isStarknet(home) ? home : remote) as StarknetChain;
  const evmChainData   = (isStarknet(home) ? remote : home) as LZChain & { kind: 'evm' };
  const cairoAddr = isStarknet(home) ? homeAddr : remoteAddr;
  const evmAddr   = isStarknet(home) ? remoteAddr : homeAddr;

  const [checking, setChecking] = useState(false);
  const [evmState, setEvmState] = useState<EvmSideState | null>(null);
  const [starkState, setStarkState] = useState<StarkSideState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fetchTick && fetchTick > 0) runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTick]);

  // Auto-run checks (debounced) when addresses or chain EIDs change
  const autoCheckTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!isAddr(cairoAddr) || !isAddr(evmAddr)) return;
    clearTimeout(autoCheckTimer.current);
    autoCheckTimer.current = setTimeout(() => { void runChecks(); }, 1500);
    return () => clearTimeout(autoCheckTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cairoAddr, evmAddr, home.eid, remote.eid]);

  async function runChecks(): Promise<void> {
    if (!isAddr(cairoAddr) || !isAddr(evmAddr)) return;
    setChecking(true); setError(null); setEvmState(null); setStarkState(null);
    try {
      const [evmResult, starkResult] = await Promise.allSettled([
        readEvmSide(evmAddr, starkChainData.eid, evmChainData),
        (async (): Promise<StarkSideState> => {
          const [sendLib, recvLibResult, delegate, enforcedOptions, peerState] = await Promise.all([
            cairoEndpoint.readSendLibrary(starkChainData.endpoint, cairoAddr, evmChainData.eid, starkChainData.rpc),
            cairoEndpoint.readReceiveLibrary(starkChainData.endpoint, cairoAddr, evmChainData.eid, starkChainData.rpc),
            cairoEndpoint.readDelegate(starkChainData.endpoint, cairoAddr, starkChainData.rpc),
            cairo.readEnforcedOptions(cairoAddr, evmChainData.eid, starkChainData.rpc),
            cairo.readPeer(cairoAddr, evmChainData.eid, starkChainData.rpc),
          ]);
          return {
            sendLib,
            recvLib: recvLibResult.lib,
            recvLibIsDefault: recvLibResult.isDefault,
            delegate,
            enforcedOptions,
            peer: peerState.peer,
          };
        })(),
      ]);
      if (evmResult.status === 'fulfilled') setEvmState(evmResult.value);
      else setError(`EVM read error: ${evmResult.reason}`);
      if (starkResult.status === 'fulfilled') setStarkState(starkResult.value);
      else setError((e) => (e ? e + ' | ' : '') + `Starknet read error: ${starkResult.reason}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setChecking(false);
  }

  const expectedEvmPeer  = isAddr(cairoAddr) ? addrToBytes32(cairoAddr) : null;
  const expectedCairoPeer = isAddr(evmAddr)  ? addrToBytes32(evmAddr)  : null;
  const ZERO64 = '0x' + '0'.repeat(64);

  const done = !checking && (evmState !== null || starkState !== null);

  return (
    <section className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-headline text-base font-bold text-on-surface m-0">Pathway verification</h3>
          <span className="text-xs text-on-surface-variant">
            {home.name} (EID {home.eid}) ↔ {remote.name} (EID {remote.eid})
          </span>
        </div>
        <button className="btn btn-primary" onClick={runChecks} disabled={checking || !isAddr(cairoAddr) || !isAddr(evmAddr)}>
          {checking ? 'Checking…' : 'Run checks'}
        </button>
      </div>

      {!done && !checking && (
        <p className="text-xs text-on-surface-variant">
          Enter both contract addresses above, then press <strong>Run checks</strong> to read on-chain state from both endpoints. No wallet required.
        </p>
      )}
      {error && <div className="check-row check-critical"><span>{error}</span></div>}

      {/* ── EVM side ── */}
      {evmState && (
        <>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant mt-3 mb-1">
            {evmChainData.name} (send → Starknet)
          </div>
          <CheckRow label="Send library set" passed={!!evmState.sendLib && evmState.sendLib !== '0x0000000000000000000000000000000000000000'} detail={evmState.sendLib ?? 'Not set'} />
          <CheckRow label="Executor configured" passed={!!evmState.executor && evmState.executor.executor !== '0x0000000000000000000000000000000000000000'} detail={evmState.executor ? `${evmState.executor.executor} (max ${evmState.executor.maxMessageSize} bytes)` : 'Not configured'} />
          <CheckRow label="DVNs configured (send)" passed={!!evmState.dvnSend && evmState.dvnSend.requiredDVNCount > 0} detail={evmState.dvnSend?.requiredDVNCount ? `${evmState.dvnSend.requiredDVNCount} required: ${evmState.dvnSend.requiredDVNs.join(', ')}` : 'No DVNs set'} />
          <CheckRow label="Enforced options set" passed={!!evmState.enforcedOptions && evmState.enforcedOptions !== '0x'} detail={evmState.enforcedOptions ?? 'Not set'} />
          <CheckRow label="Delegate set" passed={!!evmState.delegate && evmState.delegate !== '0x0000000000000000000000000000000000000000'} detail={evmState.delegate ?? 'Not set'} severity="warning" />
          <CheckRow label="Peer set (EVM → Starknet)"
            passed={!!evmState.peer && evmState.peer !== ZERO64 && expectedEvmPeer !== null && evmState.peer.toLowerCase() === expectedEvmPeer.toLowerCase()}
            detail={evmState.peer && evmState.peer !== ZERO64 ? evmState.peer : 'Not set'} />
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant mt-3 mb-1">
            {evmChainData.name} (receive ← Starknet)
          </div>
          <CheckRow label="Receive library set" passed={!!evmState.recvLib && evmState.recvLib !== '0x0000000000000000000000000000000000000000' && !evmState.recvLibIsDefault}
            detail={evmState.recvLib ? `${evmState.recvLib}${evmState.recvLibIsDefault ? ' (default — set explicitly)' : ''}` : 'Not set'}
            severity={evmState.recvLibIsDefault ? 'warning' : 'critical'} />
          <CheckRow label="DVNs configured (receive)" passed={!!evmState.dvnRecv && evmState.dvnRecv.requiredDVNCount > 0} detail={evmState.dvnRecv?.requiredDVNCount ? `${evmState.dvnRecv.requiredDVNCount} required: ${evmState.dvnRecv.requiredDVNs.join(', ')}` : 'No DVNs set'} />
        </>
      )}

      {/* ── Starknet side ── */}
      {starkState && (
        <>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-tertiary mt-3 mb-1">
            {starkChainData.name} (send → EVM)
          </div>
          <CheckRow label="Send library set" passed={!!starkState.sendLib} detail={starkState.sendLib ?? 'Not set'} />
          <CheckRow label="Enforced options set" passed={starkState.enforcedOptions} detail={starkState.enforcedOptions ? 'Set' : 'Not set'} />
          <CheckRow label="Delegate set" passed={!!starkState.delegate} detail={starkState.delegate ?? 'Not set'} severity="warning" />
          <CheckRow label="Peer set (Starknet → EVM)"
            passed={!!starkState.peer && starkState.peer !== ZERO64 && expectedCairoPeer !== null && starkState.peer.toLowerCase() === expectedCairoPeer.toLowerCase()}
            detail={starkState.peer && starkState.peer !== ZERO64 ? starkState.peer : 'Not set'} />
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-tertiary mt-3 mb-1">
            {starkChainData.name} (receive ← EVM)
          </div>
          <CheckRow label="Receive library set" passed={!!starkState.recvLib && !starkState.recvLibIsDefault}
            detail={starkState.recvLib ? `${starkState.recvLib}${starkState.recvLibIsDefault ? ' (default)' : ''}` : 'Not set'}
            severity={starkState.recvLibIsDefault ? 'warning' : 'critical'} />
        </>
      )}
    </section>
  );
}

// ── Shared column header ──────────────────────────────────────────────────────

function ChainColumnHeader({ label, chainName, eid, connected }: {
  label: string; chainName: string; eid: number; connected: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
      <span className="text-xs text-on-surface-variant">{chainName} — EID {eid}</span>
      {connected
        ? <span className="text-xs text-secondary ml-auto flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block"></span>connected</span>
        : <span className="text-xs text-outline-variant ml-auto">wallet needed</span>}
    </div>
  );
}

// ── Shared peer connect section (gate) ────────────────────────────────────────

interface PeerSideConfig {
  chainName: string;
  chainId: number;
  peerLabel: string;
  peerBytes32: string;
  connectedChainId: number | null;
  isConnected: boolean;
  onSwitch: () => void;
  onSet: () => Promise<TxState>;
}

function PeerConnectSection({ left, right, evm }: {
  left: PeerSideConfig;
  right: PeerSideConfig;
  evm?: ReturnType<typeof useEvmWallet>;  // only for EVM-EVM
}): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [leftTx, setLeftTx] = useState<TxState>({ status: 'idle' });
  const [rightTx, setRightTx] = useState<TxState>({ status: 'idle' });

  return (
    <div className={`bg-surface-container-low rounded-xl border p-6 mt-4 ${confirmed ? 'border-secondary/20' : 'border-outline-variant/10'}`}>
      <div className="mb-4">
        <div className="font-headline text-sm font-bold text-on-surface mb-2">Connect Peers</div>
        <div className="step-warn-banner">
          ⚠ Setting peers opens the messaging channel. Tokens can flow immediately. Complete all configuration steps on both sides first.
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer mb-4">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Both sides are fully configured and the addresses above are correct.
      </label>
      <div className="flex gap-4">
        {/* Left side peer */}
        <div className="flex-1">
          <div className="label">{left.peerLabel}</div>
          <div className="mono-block mb-2">{left.peerBytes32 || '(enter address above)'}</div>
          {left.chainId > 0 && left.connectedChainId !== left.chainId && (
            <button className="btn text-[11px] py-1 px-2.5 mb-1.5" onClick={left.onSwitch}>
              Switch to {left.chainName}
            </button>
          )}
          <div>
            <button className="btn btn-primary"
              disabled={!confirmed || (left.chainId > 0 && (!left.isConnected || left.connectedChainId !== left.chainId))}
              onClick={async () => { setLeftTx({ status: 'pending' }); setLeftTx(await left.onSet()); }}>
              Set Peer on {left.chainName}
            </button>
          </div>
          <div className="mt-1.5"><TxStatus state={leftTx} /></div>
        </div>
        {/* Right side peer */}
        <div className="flex-1">
          <div className="label">{right.peerLabel}</div>
          <div className="mono-block mb-2">{right.peerBytes32 || '(enter address above)'}</div>
          {right.chainId > 0 && right.connectedChainId !== right.chainId && (
            <button className="btn text-[11px] py-1 px-2.5 mb-1.5" onClick={right.onSwitch}>
              Switch to {right.chainName}
            </button>
          )}
          <div>
            <button className="btn btn-primary"
              disabled={!confirmed || (right.chainId > 0 && (!right.isConnected || right.connectedChainId !== right.chainId))}
              onClick={async () => { setRightTx({ status: 'pending' }); setRightTx(await right.onSet()); }}>
              Set Peer on {right.chainName}
            </button>
          </div>
          <div className="mt-1.5"><TxStatus state={rightTx} /></div>
        </div>
      </div>
    </div>
  );
}

// ── EVM-EVM configure panel (side-by-side) ────────────────────────────────────

function checkPassed(result: PathwayVerifyResult | null, label: string): boolean {
  return result?.checks.find((c) => c.label === label)?.passed ?? false;
}

function EvmEvmConfigurePanel({ homeChain, remoteChain, homeAddr, remoteAddr, mode, evm, wiring, verifyResult }: {
  homeChain: LZChain; remoteChain: LZChain;
  homeAddr: string; remoteAddr: string;
  mode: WiringMode;
  evm: ReturnType<typeof useEvmWallet>;
  wiring: ReturnType<typeof useOFTWiring>;
  verifyResult: PathwayVerifyResult | null;
}): JSX.Element {
  const isAdapter = mode === 'bridge-oft';
  const homeConnected = evm.isConnected && evm.chainId === homeChain.chainId;
  const remoteConnected = evm.isConnected && evm.chainId === remoteChain.chainId;
  const [evmSide, setEvmSide] = useState<'home' | 'remote'>('home');

  const homeSteps = [
    ...(isAdapter ? [{ label: 'Rate Limit', done: false }] : []),
    { label: 'Libraries', done: checkPassed(verifyResult, 'Send library set') },
    { label: 'DVN',       done: checkPassed(verifyResult, 'DVNs configured (send side)') && checkPassed(verifyResult, 'Executor configured') },
    { label: 'Options',   done: checkPassed(verifyResult, 'Enforced options set (send side)') },
  ];

  const remoteSteps = [
    { label: 'Libraries', done: checkPassed(verifyResult, 'Receive library set') },
    { label: 'DVN',       done: checkPassed(verifyResult, 'DVNs configured (receive side)') },
    { label: 'Options',   done: checkPassed(verifyResult, 'Enforced options set (receive side)') },
  ];

  return (
    <div>
      {/* Side tabs */}
      <div className="flex gap-2 mb-4">
        <button
          className={`px-4 py-2 rounded text-xs font-headline font-bold transition-colors ${evmSide === 'home' ? 'bg-surface-container-high text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
          onClick={() => setEvmSide('home')}>
          <span className="flex items-center gap-1.5">
            {homeConnected && <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block" />}
            {homeChain.name}
          </span>
        </button>
        <button
          className={`px-4 py-2 rounded text-xs font-headline font-bold transition-colors ${evmSide === 'remote' ? 'bg-surface-container-high text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
          onClick={() => setEvmSide('remote')}>
          <span className="flex items-center gap-1.5">
            {remoteConnected && <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block" />}
            {remoteChain.name}
          </span>
        </button>
      </div>

      {evmSide === 'home' && (
        <>
          <ChainColumnHeader label={isAdapter ? 'Adapter' : 'OFT'} chainName={homeChain.name} eid={homeChain.eid} connected={homeConnected} />
          <StepProgressBar steps={homeSteps} />
          <GuidedConfigure
            homeChain={homeChain} remoteChain={remoteChain}
            adapterAddr={homeAddr} peerAddr={remoteAddr}
            connectedChainId={evm.chainId} isConnected={evm.isConnected}
            signer={evm.signer} onSwitchNetwork={evm.switchNetwork}
            wiring={wiring} verifyResult={verifyResult}
            isAdapter={isAdapter} isRemoteEvm={false} hidePeerStep
          />
        </>
      )}

      {evmSide === 'remote' && (
        <>
          <ChainColumnHeader label="OFT" chainName={remoteChain.name} eid={remoteChain.eid} connected={remoteConnected} />
          <StepProgressBar steps={remoteSteps} />
          <GuidedConfigure
            homeChain={remoteChain} remoteChain={homeChain}
            adapterAddr={remoteAddr} peerAddr={homeAddr}
            connectedChainId={evm.chainId} isConnected={evm.isConnected}
            signer={evm.signer} onSwitchNetwork={evm.switchNetwork}
            wiring={wiring} verifyResult={null}
            isAdapter={false} isRemoteEvm={false} hidePeerStep
          />
        </>
      )}

      <PeerConnectSection
        left={{
          chainName: homeChain.name,
          chainId: homeChain.chainId,
          peerLabel: `${homeChain.name} → ${remoteChain.name}`,
          peerBytes32: isAddr(remoteAddr) ? addrToBytes32(remoteAddr) : '',
          connectedChainId: evm.chainId,
          isConnected: evm.isConnected,
          onSwitch: () => evm.switchNetwork(homeChain.chainId),
          onSet: () => wiring.setEvmPeer(homeAddr, remoteChain.eid, remoteAddr),
        }}
        right={{
          chainName: remoteChain.name,
          chainId: remoteChain.chainId,
          peerLabel: `${remoteChain.name} → ${homeChain.name}`,
          peerBytes32: isAddr(homeAddr) ? addrToBytes32(homeAddr) : '',
          connectedChainId: evm.chainId,
          isConnected: evm.isConnected,
          onSwitch: () => evm.switchNetwork(remoteChain.chainId),
          onSet: () => wiring.setEvmPeer(remoteAddr, homeChain.eid, homeAddr),
        }}
      />
    </div>
  );
}

// ── Starknet configure panel (side-by-side EVM | Starknet) ────────────────────

function StarknetConfigurePanel({ home, remote, homeAddr, remoteAddr, wiringMode, stark, cairo, cairoEndpoint, wiring, evm, verifyResult }: {
  home: AnyChain; remote: AnyChain;
  homeAddr: string; remoteAddr: string;
  wiringMode: WiringMode;
  stark: ReturnType<typeof useStarknetWallet>;
  cairo: ReturnType<typeof useCairoOFT>;
  cairoEndpoint: ReturnType<typeof useCairoEndpoint>;
  wiring: ReturnType<typeof useOFTWiring>;
  evm: ReturnType<typeof useEvmWallet>;
  verifyResult: PathwayVerifyResult | null;
}): JSX.Element {
  const starkChainData = (isStarknet(home) ? home : remote) as StarknetChain;
  const evmChainData   = (isStarknet(home) ? remote : home) as LZChain & { kind: 'evm' };
  const cairoAddr = isStarknet(home) ? homeAddr : remoteAddr;
  const evmAddr   = isStarknet(home) ? remoteAddr : homeAddr;
  const evmIsHome = isEvm(home);
  const isAdapter = wiringMode === 'bridge-oft';

  const starkAsRemote: LZChain = {
    eid: starkChainData.eid, chainId: -1, chainKey: starkChainData.chainKey,
    name: starkChainData.name, endpoint: starkChainData.endpoint,
    rpc: starkChainData.rpc, isTestnet: starkChainData.isTestnet,
    sendLib: starkChainData.sendLib, receiveLib: starkChainData.receiveLib,
  };

  const evmConnected  = evm.isConnected && evm.chainId === evmChainData.chainId;
  const starkConnected = stark.isConnected;
  const starkHint = !starkConnected ? <span className="text-xs text-on-surface-variant">Connect Starknet wallet first</span> : null;

  // Starknet accordion — correct LZ order: Delegate→Libraries→DVNs→Executor→EnforcedOptions→Peer(last)
  const [openStarkStep, setOpenStarkStep] = useState<number | null>(1);
  const toggleStark = (n: number) => setOpenStarkStep((p) => (p === n ? null : n));

  // Tx states
  const [delegateTx,     setDelegateTx]     = useState<TxState>({ status: 'idle' });
  const [libTx,          setLibTx]          = useState<TxState>({ status: 'idle' });
  const [sendConfigTx,   setSendConfigTx]   = useState<TxState>({ status: 'idle' });
  const [recvConfigTx,   setRecvConfigTx]   = useState<TxState>({ status: 'idle' });
  const [enforcedOptsTx, setEnforcedOptsTx] = useState<TxState>({ status: 'idle' });

  // Field state
  const [cairoDelegate,    setCairoDelegate]    = useState('');
  const [cairoLib,         setCairoLib]         = useState(starkChainData.sendLib ?? '');
  const [cairoGracePeriod, setCairoGracePeriod] = useState('0');
  const [cairoConfirm,     setCairoConfirm]     = useState(starkChainData.isTestnet ? '1' : '15');
  const [cairoExecutor,    setCairoExecutor]    = useState(starkChainData.executor ?? '');
  const [cairoMaxMsgSize,  setCairoMaxMsgSize]  = useState('10000');
  const [cairoGas,         setCairoGas]         = useState('80000');

  // DVNs — single pair for send and receive (same DVNs on both directions is standard)
  const [sendDvns, setSendDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [recvDvns, setRecvDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [sameRecvDvns, setSameRecvDvns] = useState(true);
  const { dvns: availableDvns, loading: dvnsLoading } = useDVNCatalog(starkChainData.chainKey);

  function toggleDvn(side: 'send' | 'recv', addr: string, provider: DVNProvider) {
    const setter = side === 'send' ? setSendDvns : setRecvDvns;
    setter((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, provider); return next; });
  }

  // When "same DVNs" toggle is on, keep recv in sync with send
  function toggleSendDvn(addr: string, provider: DVNProvider) {
    setSendDvns((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, provider); return next; });
    if (sameRecvDvns) {
      setRecvDvns((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, provider); return next; });
    }
  }

  // EVM column is always left, Starknet always right (symmetric regardless of home/remote)
  return (
    <div>
      <div className="flex gap-4 items-start">

        {/* ── EVM column (left) ── */}
        <div className="flex-1 min-w-0">
          <ChainColumnHeader label="EVM" chainName={evmChainData.name} eid={evmChainData.eid} connected={evmConnected} />
          <StepProgressBar steps={[
            ...(isAdapter && evmIsHome ? [{ label: 'Rate Limit', done: false }] : []),
            { label: 'Libraries', done: checkPassed(verifyResult, 'Send library set') },
            { label: 'DVN',       done: checkPassed(verifyResult, 'DVNs configured (send side)') && checkPassed(verifyResult, 'Executor configured') },
            { label: 'Options',   done: checkPassed(verifyResult, 'Enforced options set (send side)') },
          ]} />
          <GuidedConfigure
            homeChain={evmChainData}
            remoteChain={starkAsRemote}
            adapterAddr={evmIsHome ? homeAddr : remoteAddr}
            peerAddr={evmIsHome ? remoteAddr : homeAddr}
            connectedChainId={evm.chainId}
            isConnected={evm.isConnected}
            signer={evm.signer}
            onSwitchNetwork={evm.switchNetwork}
            wiring={wiring}
            verifyResult={verifyResult}
            isAdapter={isAdapter && evmIsHome}
            isRemoteEvm={false}
            hidePeerStep
          />
        </div>

        {/* ── Starknet column (right) ── */}
        <div className="flex-1 min-w-0">
          <ChainColumnHeader label="Starknet" chainName={starkChainData.name} eid={starkChainData.eid} connected={starkConnected} />

          <StepProgressBar steps={[
            { label: 'Delegate',          done: delegateTx.status === 'success' },
            { label: 'Message Libraries', done: libTx.status === 'success' },
            { label: 'Send Config',       done: sendConfigTx.status === 'success' },
            { label: 'Receive Config',    done: recvConfigTx.status === 'success' },
            { label: 'Enforced Options',  done: enforcedOptsTx.status === 'success' },
          ]} />

          {/* Step 1 — Delegate (FIRST — required before endpoint can be configured) */}
          <CairoStepCard n={1} title="Delegate" subtitle="Set delegate before configuring the endpoint. Required first step."
            done={delegateTx.status === 'success'}
            open={openStarkStep === 1} onToggle={() => toggleStark(1)}>
            <p className="step-hint">The delegate authorises an external account to configure the endpoint on behalf of this OFT. Must be set before steps 2–4.</p>
            <div className="mb-2">
              <div className="label">Delegate address</div>
              <input className="input" value={cairoDelegate} onChange={(e) => setCairoDelegate(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr || !cairoDelegate}
                onClick={async () => { setDelegateTx({ status: 'pending' }); setDelegateTx(await cairoEndpoint.setDelegate(cairoAddr, cairoDelegate, starkChainData.rpc)); }}>
                Set Delegate
              </button>
              {starkHint}
            </div>
            <TxStatus state={delegateTx} />
          </CairoStepCard>

          {/* Step 2 — Message Libraries */}
          <CairoStepCard n={2} title="Message Libraries" subtitle="Set send & receive library. On Starknet both use the same address."
            done={libTx.status === 'success'}
            open={openStarkStep === 2} onToggle={() => toggleStark(2)}>
            <p className="step-hint">SendUln302 and ReceiveUln302 are the same contract on Starknet — one address sets both directions.</p>
            {starkChainData.sendLib && (
              <div className="text-xs text-on-surface-variant mb-2">
                Known lib: <span className="font-mono text-[11px] text-on-surface">{starkChainData.sendLib}</span>
              </div>
            )}
            <div className="mb-2">
              <div className="label">Library address (ULN302)</div>
              <input className="input" value={cairoLib} onChange={(e) => setCairoLib(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div className="mb-2">
              <div className="label">Grace period (blocks, 0 = immediate)</div>
              <input className="input w-[120px]" value={cairoGracePeriod} onChange={(e) => setCairoGracePeriod(e.target.value)} />
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr || !cairoLib}
                onClick={async () => { setLibTx({ status: 'pending' }); setLibTx(await cairoEndpoint.setLibraries(starkChainData.endpoint, cairoAddr, evmChainData.eid, cairoLib, Number(cairoGracePeriod), starkChainData.rpc)); }}>
                Set Send &amp; Receive Library
              </button>
              {starkHint}
            </div>
            <TxStatus state={libTx} />
          </CairoStepCard>

          {/* Step 3 — Send Config: DVN + Executor (atomic, per LZ SDK recommendation) */}
          <CairoStepCard n={3} title="Send Config" subtitle="Set DVN security stack + executor atomically on the Starknet Endpoint (send direction)."
            done={sendConfigTx.status === 'success'}
            open={openStarkStep === 3} onToggle={() => toggleStark(3)}>
            <p className="step-hint">DVN and executor are set together in one transaction (LZ recommended). DVN addresses are sorted ascending automatically.</p>
            <div className="mb-2 text-xs text-on-surface-variant">
              Using library: <span className="font-mono text-on-surface">{cairoLib || <span className="text-outline-variant">not set — configure in step 2</span>}</span>
            </div>
            <div className="mb-2">
              <div className="label">Required DVNs (send — Starknet → EVM)</div>
              <CairoDVNPicker dvns={availableDvns} loading={dvnsLoading} selected={sendDvns} onToggle={(a, p) => toggleSendDvn(a, p)} />
              {sendDvns.size === 0 && <div className="text-[11px] text-on-surface-variant mt-1">Select at least one DVN</div>}
            </div>
            <div className="form-grid mb-2">
              <div>
                <div className="label">Block confirmations</div>
                <input className="input" value={cairoConfirm} onChange={(e) => setCairoConfirm(e.target.value)} />
              </div>
              <div>
                <div className="label">Max message size (bytes)</div>
                <input className="input" value={cairoMaxMsgSize} onChange={(e) => setCairoMaxMsgSize(e.target.value)} />
              </div>
            </div>
            <div className="mb-2">
              <div className="label">Executor address</div>
              <input className="input" value={cairoExecutor} onChange={(e) => setCairoExecutor(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <button className="btn btn-primary"
                disabled={!starkConnected || !cairoAddr || !cairoLib || sendDvns.size === 0 || !cairoExecutor}
                onClick={async () => {
                  setSendConfigTx({ status: 'pending' });
                  setSendConfigTx(await cairoEndpoint.setSendConfigsAtomic(
                    starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid,
                    { confirmations: Number(cairoConfirm), requiredDvns: sortDvns([...sendDvns.keys()]) },
                    { maxMessageSize: Number(cairoMaxMsgSize), executor: cairoExecutor },
                    starkChainData.rpc,
                  ));
                }}>Set Send Config (DVN + Executor)</button>
              {starkHint}
            </div>
            <TxStatus state={sendConfigTx} />
          </CairoStepCard>

          {/* Step 4 — Receive Config: DVN only (executor not used on receive side) */}
          <CairoStepCard n={4} title="Receive Config" subtitle="Set DVN security stack on the Starknet Endpoint (receive direction)."
            done={recvConfigTx.status === 'success'}
            open={openStarkStep === 4} onToggle={() => toggleStark(4)}>
            <p className="step-hint">Receive side only needs DVN config — no executor required. By default uses the same DVNs as send.</p>
            <div className="mb-2 text-xs text-on-surface-variant">
              Using library: <span className="font-mono text-on-surface">{cairoLib || <span className="text-outline-variant">not set — configure in step 2</span>}</span>
            </div>
            {/* Same-DVNs toggle */}
            <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer mb-2">
              <input type="checkbox" checked={sameRecvDvns} onChange={(e) => {
                setSameRecvDvns(e.target.checked);
                if (e.target.checked) setRecvDvns(new Map(sendDvns));
              }} />
              Use same DVNs as send direction (recommended)
            </label>
            {!sameRecvDvns && (
              <div className="mb-2">
                <div className="label">Required DVNs (receive — EVM → Starknet)</div>
                <CairoDVNPicker dvns={availableDvns} loading={dvnsLoading} selected={recvDvns} onToggle={(a, p) => toggleDvn('recv', a, p)} />
                {recvDvns.size === 0 && <div className="text-[11px] text-on-surface-variant mt-1">Select at least one DVN</div>}
              </div>
            )}
            <div className="mb-2">
              <div className="label">Block confirmations</div>
              <input className="input w-[100px]" value={cairoConfirm} onChange={(e) => setCairoConfirm(e.target.value)} />
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <button className="btn btn-primary"
                disabled={!starkConnected || !cairoAddr || !cairoLib || (sameRecvDvns ? sendDvns.size === 0 : recvDvns.size === 0)}
                onClick={async () => {
                  setRecvConfigTx({ status: 'pending' });
                  const dvns = sameRecvDvns ? sendDvns : recvDvns;
                  setRecvConfigTx(await cairoEndpoint.setUlnReceiveConfig(
                    starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid,
                    { confirmations: Number(cairoConfirm), requiredDvns: sortDvns([...dvns.keys()]) },
                    starkChainData.rpc,
                  ));
                }}>Set Receive Config</button>
              {starkHint}
            </div>
            <TxStatus state={recvConfigTx} />
          </CairoStepCard>

          {/* Step 5 — Enforced Options (AFTER DVNs and executor, before peers) */}
          <CairoStepCard n={5} title="Enforced Options" subtitle="Set minimum gas for lzReceive on the Starknet OFT."
            done={enforcedOptsTx.status === 'success'}
            open={openStarkStep === 5} onToggle={() => toggleStark(5)}>
            <p className="step-hint">Must be set after DVN and executor config, but before opening peers.</p>
            <div className="flex gap-2 items-end flex-wrap mb-2">
              <div>
                <div className="label">Gas limit for lzReceive</div>
                <input className="input w-[140px]" value={cairoGas} onChange={(e) => setCairoGas(e.target.value)} />
              </div>
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr}
                onClick={async () => { setEnforcedOptsTx({ status: 'pending' }); setEnforcedOptsTx(await cairoEndpoint.setEnforcedOptions(cairoAddr, evmChainData.eid, BigInt(cairoGas), starkChainData.rpc)); }}>
                Set on Starknet OFT
              </button>
              {starkHint}
            </div>
            <TxStatus state={enforcedOptsTx} />
          </CairoStepCard>
        </div>

      </div>

      {/* ── Shared peer section (gated) ── */}
      <PeerConnectSection
        left={{
          chainName: evmChainData.name,
          chainId: evmChainData.chainId,
          peerLabel: `${evmChainData.name} → Starknet`,
          peerBytes32: isAddr(cairoAddr) ? addrToBytes32(cairoAddr) : '',
          connectedChainId: evm.chainId,
          isConnected: evm.isConnected,
          onSwitch: () => evm.switchNetwork(evmChainData.chainId),
          onSet: () => wiring.setEvmPeer(evmIsHome ? homeAddr : remoteAddr, starkChainData.eid, cairoAddr),
        }}
        right={{
          chainName: starkChainData.name,
          chainId: -1,   // no chainId gate for Starknet (wallet is already connected)
          peerLabel: `Starknet → ${evmChainData.name}`,
          peerBytes32: isAddr(evmAddr) ? addrToBytes32(evmAddr) : '',
          connectedChainId: null,
          isConnected: starkConnected,
          onSwitch: () => {},
          onSet: () => cairo.setPeer(cairoAddr, evmChainData.eid, evmAddr),
        }}
      />
    </div>
  );
}

// ── Cairo DVN picker (inline, no external search) ─────────────────────────────

function CairoDVNPicker({ dvns, loading, selected, onToggle }: {
  dvns: DVNProvider[];
  loading: boolean;
  selected: Map<string, DVNProvider>;
  onToggle: (addr: string, provider: DVNProvider) => void;
}): JSX.Element {
  if (loading) return <div className="text-xs text-on-surface-variant">Loading DVNs…</div>;
  if (dvns.length === 0) return (
    <div className="text-xs text-on-surface-variant">No DVNs found for this chain. Enter addresses manually if needed.</div>
  );
  return (
    <div className="flex flex-col gap-1">
      {dvns.map((p) => {
        const addr = p.address.toLowerCase();
        const checked = selected.has(addr);
        return (
          <label key={p.address} style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            padding: '6px 8px', borderRadius: 6,
            background: checked ? p.color + '15' : 'transparent',
            border: `1px solid ${checked ? p.color + '66' : 'rgba(64,72,93,0.3)'}`,
          }}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(addr, p)} />
            <DVNIcon provider={p} size={22} />
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-on-surface">{p.name}</div>
              <div className="text-[10px] text-on-surface-variant font-mono">{p.address.slice(0, 12)}…{p.address.slice(-6)}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function CairoStepCard({ n, title, subtitle, done, open, onToggle, children }: {
  n: number; title: string; subtitle: string;
  /** true = completed this session (tx success) */
  done?: boolean;
  open: boolean; onToggle: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`bg-surface-container rounded-lg border mt-1.5 overflow-hidden ${open ? 'border-outline-variant/20' : done ? 'border-secondary/20' : 'border-outline-variant/10'}`}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container-high transition-colors" onClick={onToggle}>
        <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0 ${done ? 'bg-secondary/15 border border-secondary/40 text-secondary' : 'bg-primary/10 border border-primary/20 text-primary'}`}>
          {done ? '✓' : n}
        </span>
        <div className="flex-1">
          <div className={`font-headline text-sm font-semibold ${done ? 'text-secondary' : 'text-on-surface'}`}>{title}</div>
          <div className="text-[11px] text-on-surface-variant">{subtitle}</div>
        </div>
        <span className="text-on-surface-variant text-xs ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-2 border-t border-outline-variant/10">{children}</div>}
    </div>
  );
}

/** Compact step progress bar — shows X/total steps with colour-coded dots. */
function StepProgressBar({ steps }: { steps: Array<{ label: string; done: boolean }> }): JSX.Element {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  return (
    <div className="flex items-center gap-3 mb-3 px-1">
      <div className="flex gap-1.5">
        {steps.map((s, i) => (
          <span key={i} title={s.label}
            className={`w-2 h-2 rounded-full transition-colors ${s.done ? 'bg-secondary' : 'bg-outline-variant/30'}`} />
        ))}
      </div>
      <span className={`text-[11px] font-mono ${allDone ? 'text-secondary' : 'text-on-surface-variant'}`}>
        {doneCount}/{steps.length} steps {allDone ? 'complete ✓' : 'done'}
      </span>
    </div>
  );
}

// ── Peers sidebar ─────────────────────────────────────────────────────────────

function PeersSidebar({ peers, scanning, error, canScan, bridgeAddr, bridgeLabel = 'Adapter', chainName, isTestnet, onScan }: {
  peers: PeerEntry[] | null;
  scanning: boolean;
  error: string | null;
  canScan: boolean;
  bridgeAddr: string;
  bridgeLabel?: string;
  chainName: string;
  isTestnet: boolean;
  onScan: () => void;
}): JSX.Element {
  const connected = peers?.filter((p) => p.peer !== null) ?? [];
  const unset = peers?.filter((p) => p.peer === null) ?? [];
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-headline text-sm font-bold text-on-surface">Connected Peers</div>
          <div className="text-[11px] text-on-surface-variant mt-0.5">{chainName || 'select home chain'}</div>
        </div>
        <button
          className="btn btn-primary text-[12px] py-1 px-2.5"
          disabled={!canScan || scanning}
          onClick={onScan}
          title={!canScan ? 'Enter a contract address and select home chain first' : ''}
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {!peers && !scanning && !error && (
        <div className="text-xs text-on-surface-variant text-center py-5">
          Enter a contract address above and press <strong>Scan</strong> to discover all connected chains.
        </div>
      )}

      {scanning && (
        <div className="text-xs text-on-surface-variant text-center py-5">
          Querying {isTestnet ? 'testnet' : 'mainnet'} chains…
        </div>
      )}

      {error && (
        <div className="text-xs text-error break-all">Error: {error}</div>
      )}

      {peers && !scanning && (
        <>
          {/* Summary */}
          <div className="flex gap-2 mb-3 text-xs">
            <span className="text-secondary font-semibold">{connected.length} connected</span>
            <span className="text-on-surface-variant">/ {peers.length} checked</span>
          </div>

          {/* Adapter address */}
          <div className="mb-3 p-2 bg-surface-container rounded-lg border border-outline-variant/10">
            <div className="text-[10px] text-on-surface-variant mb-0.5">{bridgeLabel}</div>
            <div className="font-mono text-[11px] text-on-surface break-all">{bridgeAddr}</div>
          </div>

          {/* Connected peers */}
          {connected.length === 0 && (
            <div className="text-xs text-on-surface-variant text-center py-2">No peers set</div>
          )}
          {connected.map((p) => (
            <PeerRow key={p.eid} entry={p} />
          ))}

          {/* Unset chains toggle */}
          {unset.length > 0 && (
            <>
              <button
                className="btn btn-ghost text-[11px] w-full mt-2 justify-center"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? '▲ Hide' : `▼ Show ${unset.length} unset chain${unset.length > 1 ? 's' : ''}`}
              </button>
              {showAll && unset.map((p) => (
                <PeerRow key={p.eid} entry={p} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function PeerRow({ entry }: { entry: PeerEntry }): JSX.Element {
  const isSet = entry.peer !== null;
  const isStarknetEid = entry.eid === 40500 || entry.eid === 30500;

  // Decode peer address for display
  let displayPeer = entry.peer ?? '—';
  if (isSet && isStarknetEid && entry.peer) {
    // Starknet felt: bytes32 → trim leading zeros for felt
    const felt = BigInt(entry.peer);
    displayPeer = '0x' + felt.toString(16);
  } else if (isSet && entry.peer) {
    // EVM: last 20 bytes = address
    displayPeer = '0x' + entry.peer.slice(-40);
  }

  return (
    <div className={`flex flex-col gap-0.5 p-2 mb-1.5 rounded-lg border ${isSet ? 'bg-secondary/5 border-secondary/20' : 'bg-surface-container border-outline-variant/10 opacity-40'}`}>
      <div className="flex items-center justify-between">
        <span className={`text-[13px] font-semibold flex items-center gap-1.5 ${isSet ? 'text-on-surface' : 'text-on-surface-variant'}`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSet ? 'bg-secondary' : 'bg-outline-variant'}`}></span>
          {entry.name}
        </span>
        <span className="text-[10px] text-on-surface-variant">EID {entry.eid}</span>
      </div>
      {isSet && (
        <div className="font-mono text-[11px] text-secondary break-all">
          {displayPeer.slice(0, 14)}…{displayPeer.slice(-8)}
        </div>
      )}
      {entry.error && (
        <div className="text-[10px] text-error">read error</div>
      )}
    </div>
  );
}

// ── Token banner ──────────────────────────────────────────────────────────────

function TokenBadge({ label, name, symbol }: { label: string; name: string; symbol: string }): JSX.Element {
  return (
    <div className="text-center">
      <div className="label mb-0.5">{label}</div>
      <div className="font-headline font-bold text-base text-on-surface">{symbol}</div>
      <div className="text-xs text-on-surface-variant">{name}</div>
    </div>
  );
}

// ── Verify panel ──────────────────────────────────────────────────────────────

function VerifyPanel({ homeChain, remoteChain, verifying, result, onVerify, isAdapter = true }: {
  homeChain: LZChain; remoteChain: LZChain;
  verifying: boolean; result: PathwayVerifyResult | null;
  onVerify: () => void;
  isAdapter?: boolean;
}): JSX.Element {
  const { resolveName: resolveHome } = useDVNCatalog(homeChain.chainKey);
  const { resolveName: resolveRemote } = useDVNCatalog(remoteChain.chainKey);

  function dvnLabel(addr: string, resolver: (a: string) => string | null): string {
    const name = resolver(addr);
    return name ? `${name} (${addr.slice(0, 8)}…${addr.slice(-4)})` : addr;
  }

  function resolveDetail(detail: string): string {
    return detail.replace(/0x[0-9a-fA-F]{40}/g, (addr) => {
      const name = resolveHome(addr) ?? resolveRemote(addr);
      return name ? `${name} (${addr.slice(0, 8)}…)` : addr;
    });
  }

  const criticalFailed = result?.checks.filter((c) => !c.passed && c.severity === 'critical') ?? [];
  const warnFailed = result?.checks.filter((c) => !c.passed && c.severity === 'warning') ?? [];
  const passed = result?.checks.filter((c) => c.passed) ?? [];
  const [showPassed, setShowPassed] = useState(false);

  return (
    <section className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-headline text-base font-bold text-on-surface m-0">Pathway verification</h3>
          <span className="text-xs text-on-surface-variant">
            {homeChain.name} (EID {homeChain.eid}) → {remoteChain.name} (EID {remoteChain.eid})
          </span>
        </div>
        <button className="btn" onClick={onVerify} disabled={verifying}>
          {verifying ? 'Checking…' : 'Re-run checks'}
        </button>
      </div>

      {!result && !verifying && (
        <p className="text-xs text-on-surface-variant">
          Checks run automatically when addresses are entered. Press <strong>Re-run checks</strong> to refresh.
        </p>
      )}

      {result?.error && (
        <div className="check-row check-critical"><span>RPC error: {result.error}</span></div>
      )}

      {result && !result.error && (
        <>
          <div className="verify-summary">
            <SummaryItem label="Executor" value={result.homeExecutor?.executor ?? '—'} />
            <SummaryItem label="Max msg size" value={result.homeExecutor ? `${result.homeExecutor.maxMessageSize} bytes` : '—'} />
            <SummaryItem label="Send lib" value={result.homeSendLib ?? '—'} />
            <SummaryItem label="Recv lib" value={result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : '—'} />
            <SummaryItem label="Confirmations" value={result.homeDVN ? `${result.homeDVN.confirmations} blocks` : '—'} />
            {isAdapter && result.homeRateLimit !== undefined && (
              <SummaryItem label="Rate limit" value={result.homeRateLimit ? `${String(result.homeRateLimit.limit)} / ${result.homeRateLimit.window}s` : 'disabled'} />
            )}
          </div>

          <div className="flex gap-3 my-3 text-xs">
            {criticalFailed.length > 0 && <span className="text-error font-semibold">{criticalFailed.length} critical</span>}
            {warnFailed.length > 0 && <span className="text-warning font-semibold">{warnFailed.length} warning{warnFailed.length > 1 ? 's' : ''}</span>}
            {criticalFailed.length === 0 && warnFailed.length === 0 && <span className="text-secondary font-semibold">All checks passed</span>}
            <span className="text-on-surface-variant">{passed.length}/{result.checks.length} passed</span>
          </div>

          {/* Failed checks always shown */}
          {[...criticalFailed, ...warnFailed].map((c, i) => (
            <div key={i} className={`check-row ${c.severity === 'critical' ? 'check-critical' : 'check-warn'}`}>
              <span className="check-icon">{c.severity === 'critical' ? '✗' : '!'}</span>
              <div className="flex-1">
                <div className="font-semibold">{c.label}</div>
                <div className="text-xs opacity-80 break-all">{resolveDetail(c.detail)}</div>
              </div>
            </div>
          ))}

          {/* Passed checks collapsed by default */}
          {passed.length > 0 && (
            <>
              <button
                className="btn btn-ghost text-[11px] w-full mt-2 justify-center"
                onClick={() => setShowPassed((v) => !v)}
              >
                {showPassed ? '▲ Hide passed checks' : `▼ Show ${passed.length} passed check${passed.length > 1 ? 's' : ''}`}
              </button>
              {showPassed && passed.map((c, i) => (
                <div key={i} className="check-row check-pass">
                  <span className="check-icon">✓</span>
                  <div className="flex-1">
                    <div className="font-semibold">{c.label}</div>
                    <div className="text-xs opacity-80 break-all">{resolveDetail(c.detail)}</div>
                  </div>
                </div>
              ))}
            </>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-on-surface-variant">Raw values</summary>
            <div className="mt-2 text-xs">
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
                {isAdapter && result.homeRateLimit !== undefined && (
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
      <div className="label mb-0.5">{label}</div>
      <div className={`text-xs break-all ${value === '—' ? 'text-on-surface-variant/40' : 'text-on-surface'}`}>{value}</div>
    </div>
  );
}

function RawSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-3">
      <div className="text-on-surface-variant font-semibold mb-1">{title}</div>
      {children}
    </div>
  );
}

function RawRow({ label, value }: { label: string; value: string | null | undefined }): JSX.Element {
  return (
    <div className="flex gap-2 mb-0.5">
      <span className="text-on-surface-variant min-w-[140px]">{label}</span>
      <span className="break-all text-on-surface">{value ?? '—'}</span>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="mb-2">
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  );
}
