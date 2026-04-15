import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useOFTWiring } from '@/hooks/useOFTWiring';
import { useLZVerify } from '@/hooks/useLZVerify';
import { useLZChains } from '@/hooks/useLZChains';
import { useCairoOFT } from '@/hooks/useCairoOFT';
import { useCairoEndpoint } from '@/hooks/useCairoEndpoint';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import { ConfigureFlow } from '@/components/configure/ConfigureFlow';
import { CONTRACTS, STARKNET_TESTNET, STARKNET_MAINNET } from '@/config/chains';
import type { AnyChain, LZChain, StarknetChain } from '@/config/lzCatalog';
import { isStarknet, isEvm } from '@/config/lzCatalog';
import type { PathwayVerifyResult, TokenInfo, PeerEntry, UlnConfig, ExecutorConfig } from '@/types';
import { downloadJson } from '@/components/TxStatus';
import { decodeEnforcedOptions } from '@/utils/lzOptions';
import { WalletChainHint } from '@/components/ChainSwitch';

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

  // Wiring mode — auto-detected from contract
  const [mode, setMode] = useState<WiringMode>('bridge-oft');
  const [detectedHome, setDetectedHome] = useState<'adapter' | 'oft' | null>(null);
  const [detectedRemote, setDetectedRemote] = useState<'adapter' | 'oft' | null>(null);
  const [detecting, setDetecting] = useState(false);

  // Contract addresses
  const [homeAddr, setHomeAddr] = useState(CONTRACTS.adapter);
  const [remoteAddr, setRemoteAddr] = useState(CONTRACTS.peer);

  // Tab
  const [tab, setTab] = useState<Tab>('verify');

  // EVM-EVM state
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  /** Underlying ERC20 token address (read from EVM adapter's token() call) */
  const [evmUnderlyingToken, setEvmUnderlyingToken] = useState<string | null>(null);
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

  // Auto-detect Adapter vs OFT from BOTH addresses (EVM + Starknet)
  const detectTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    setDetectedHome(null);
    setDetectedRemote(null);
    const homeValid = isAddr(homeAddr);
    const remoteValid = isAddr(remoteAddr);
    if (!homeValid && !remoteValid) return;
    clearTimeout(detectTimer.current);
    setDetecting(true);
    detectTimer.current = setTimeout(async () => {
      try {
        // Detect home side — prefer wallet RPC when available
        let homeType: 'adapter' | 'oft' | null = null;
        if (evmHome && homeValid) {
          const wp = evm.provider && evm.chainId === evmHome.chainId ? evm.provider : undefined;
          homeType = await wiring.detectOFTType(homeAddr, evmHome.rpc, wp, evmHome.chainId).catch(() => null);
        } else if (starkHome && homeValid) {
          const r = await cairo.detectCairoOFTType(homeAddr, starkHome.rpc).catch(() => null);
          if (r) {
            homeType = r.type;
            if (r.tokenAddr) setEvmUnderlyingToken(r.tokenAddr); // auto-fill underlying token
          }
        }
        // Detect remote side
        let remoteType: 'adapter' | 'oft' | null = null;
        if (evmRemote && remoteValid) {
          const rwp = evm.provider && evm.chainId === evmRemote.chainId ? evm.provider : undefined;
          remoteType = await wiring.detectOFTType(remoteAddr, evmRemote.rpc, rwp, evmRemote.chainId).catch(() => null);
        } else if (isStarknet(remote) && remoteValid) {
          const starkRemote = remote as StarknetChain;
          const r = await cairo.detectCairoOFTType(remoteAddr, starkRemote.rpc).catch(() => null);
          if (r) {
            remoteType = r.type;
            if (r.tokenAddr) setEvmUnderlyingToken(r.tokenAddr);
          }
        }
        setDetectedHome(homeType);
        setDetectedRemote(remoteType);
        if (homeType) setMode(homeType === 'adapter' ? 'bridge-oft' : 'oft-oft');
        else if (remoteType) setMode(remoteType === 'adapter' ? 'bridge-oft' : 'oft-oft');
      } catch {
        setDetectedHome(null);
        setDetectedRemote(null);
      } finally {
        setDetecting(false);
      }
    }, 800);
    return () => clearTimeout(detectTimer.current);
  }, [homeAddr, remoteAddr, evmHome?.rpc, evmRemote?.rpc, home.eid, remote.eid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleScanPeers(): Promise<void> {
    if (!canScanPeers) return;
    setPeersScanning(true);
    setPeers(null);
    setPeersError(null);
    try {
      const sc = starkChain(isTestnet);
      const starkEntry = { eid: sc.eid, name: sc.name, chainKey: sc.chainKey };
      if (evmHome) {
        const evmEntries = evmChains
          .filter((c) => c.eid !== evmHome.eid)
          .map((c) => ({ eid: c.eid, name: c.name, chainKey: c.chainKey }));
        const wp = evm.provider && evm.chainId === evmHome.chainId ? evm.provider : undefined;
        const result = await wiring.readAllPeers(homeAddr, evmHome.rpc, [...evmEntries, starkEntry], wp, evmHome.chainId);
        setPeers(result);
      } else if (starkHome) {
        const evmEntries = evmChains
          .map((c) => ({ eid: c.eid, name: c.name, chainKey: c.chainKey }));
        const result = await cairo.readAllPeers(homeAddr, evmEntries, starkHome.rpc);
        setPeers(result);
      }
    } catch (e) {
      setPeersError(e instanceof Error ? e.message : String(e));
    }
    setPeersScanning(false);
  }

  const homeLabel = detectedHome === 'adapter' ? 'Adapter' : detectedHome === 'oft' ? 'OFT' : (mode === 'bridge-oft' ? 'Adapter' : 'OFT');
  const remoteLabel = detectedRemote === 'adapter' ? 'Adapter' : detectedRemote === 'oft' ? 'OFT' : 'OFT';

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

  function walletProviderForRemote() {
    if (!evmRemote) return undefined;
    return evm.provider && evm.chainId === evmRemote.chainId ? evm.provider : undefined;
  }

  async function handleFetch(): Promise<void> {
    setFetching(true);
    setTokenInfo(null);
    setTokenInfoError(null);

    if (bothEvm && evmHome && evmRemote) {
      // Fetch only token name/symbol — verify runs separately via auto-debounce
      try {
        const wp = walletProviderForHome();
        const rwp = walletProviderForRemote();
        const info = await wiring.readTokenInfo(homeAddr, remoteAddr, evmHome.rpc, evmRemote.rpc, wp, rwp, evmHome.chainId, evmRemote.chainId);
        setTokenInfo(info);
      } catch (e) {
        setTokenInfoError('Could not read token names: ' + (e instanceof Error ? e.message : String(e)));
      }
    } else if (hasStarknet) {
      // Mixed pathway: read from both sides
      const evmSide = evmHome ?? evmRemote;
      const evmAddr = evmHome ? homeAddr : remoteAddr;
      const starkAddr = isStarknet(home) ? homeAddr : remoteAddr;
      const starkData = isStarknet(home) ? (home as StarknetChain) : (remote as StarknetChain);
      const isEvmAdapter = mode === 'bridge-oft';
      // Prefer wallet provider for EVM reads
      const evmWp = evmSide && evm.provider && evm.chainId === evmSide.chainId ? evm.provider : undefined;

      // Read EVM side info
      let evmName: { name: string; symbol: string } | null = null;
      if (evmSide && isAddr(evmAddr)) {
        try { evmName = await wiring.readEvmSideInfo(evmAddr, evmSide.rpc, isEvmAdapter, evmWp, evmSide.chainId); } catch { /* */ }
      }

      // Read Starknet side: try token() first (adapter), then read name from underlying ERC20
      let starkName: { name: string; symbol: string } | null = null;
      let starkUnderlying: string | null = null;
      if (isAddr(starkAddr)) {
        try {
          // Check if adapter (has token())
          const detect = await cairo.detectCairoOFTType(starkAddr, starkData.rpc);
          if (detect.type === 'adapter' && detect.tokenAddr) {
            starkUnderlying = detect.tokenAddr;
            setEvmUnderlyingToken(detect.tokenAddr);
            // Read name from underlying ERC20 token
            starkName = await cairo.readCairoTokenInfo(detect.tokenAddr, starkData.rpc);
          } else {
            // Plain OFT — read name from the OFT itself
            starkName = await cairo.readCairoTokenInfo(starkAddr, starkData.rpc);
          }
        } catch {
          try { starkName = await cairo.readCairoTokenInfo(starkAddr, starkData.rpc); } catch { /* */ }
        }
      }

      // Also read underlying from EVM adapter if applicable — use wallet provider
      if (isEvmAdapter && evmSide && isAddr(evmAddr) && !evmUnderlyingToken) {
        try {
          const { Contract: EContract, JsonRpcProvider: EProvider } = await import('ethers');
          const provider = evmWp ?? new EProvider(evmSide.rpc);
          const c = new EContract(evmAddr, (await import('@/abis/evm/OFTAdapter.json')).default, provider);
          const tokenAddr = await c.token() as string;
          setEvmUnderlyingToken(tokenAddr);
        } catch { /* not an adapter */ }
      }

      const starkLabel = starkName ? `${starkName.name}${starkName.symbol ? ` (${starkName.symbol})` : ''}` : '(Starknet OFT)';
      const evmLabel = evmName ? evmName.name : '(EVM OFT)';
      const evmSymbol = evmName?.symbol ?? '';

      if (isStarknet(home)) {
        setTokenInfo({ tokenName: starkLabel, tokenSymbol: starkName?.symbol ?? '', peerName: evmLabel, peerSymbol: evmSymbol });
      } else {
        setTokenInfo({ tokenName: evmLabel, tokenSymbol: evmSymbol, peerName: starkLabel, peerSymbol: starkName?.symbol ?? '' });
      }
    }

    setFetching(false);
  }

  async function handleVerify(): Promise<void> {
    if (!bothEvm || !evmHome || !evmRemote) return;
    setVerifying(true);
    setVerifyResult(null);
    const result = await verify({ adapterAddr: homeAddr, peerAddr: remoteAddr, homeChain: evmHome, remoteChain: evmRemote, walletProvider: walletProviderForHome(), remoteWalletProvider: walletProviderForRemote() });
    setVerifyResult(result);
    setVerifying(false);
  }

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
              className={`tab-btn ${isTestnet ? 'tab-btn-active' : ''}`}
              onClick={() => handleNetworkToggle(true)}>Testnet</button>
            <button
              className={`tab-btn ${!isTestnet ? 'tab-btn-active' : ''}`}
              onClick={() => handleNetworkToggle(false)}>Mainnet</button>
            {chainsLoading && <span className="text-xs text-on-surface-variant">Loading chains…</span>}
            {!chainsLoading && <span className="text-xs text-on-surface-variant">{evmChains.length} EVM + 1 Starknet</span>}
            <div className="ml-auto flex gap-2 items-center">
              {detecting && <span className="text-[11px] text-on-surface-variant animate-pulse">Detecting type…</span>}
              {!detecting && (detectedHome || detectedRemote) && (
                <div className="flex gap-1.5 items-center">
                  {detectedHome && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${detectedHome === 'adapter' ? 'bg-tertiary/10 text-tertiary border-tertiary/20' : 'bg-secondary/10 text-secondary border-secondary/20'}`}>
                      Source: {detectedHome === 'adapter' ? 'Adapter' : 'OFT'}
                    </span>
                  )}
                  {detectedRemote && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${detectedRemote === 'adapter' ? 'bg-tertiary/10 text-tertiary border-tertiary/20' : 'bg-secondary/10 text-secondary border-secondary/20'}`}>
                      Dest: {detectedRemote === 'adapter' ? 'Adapter' : 'OFT'}
                    </span>
                  )}
                </div>
              )}
              {!detecting && (!detectedHome || !detectedRemote || hasStarknet) && (
                <>
                  <span className="text-xs text-on-surface-variant">Type:</span>
                  <button
                    className={`px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${mode === 'bridge-oft' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
                    onClick={() => setMode('bridge-oft')}>Adapter</button>
                  <button
                    className={`px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${mode === 'oft-oft' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
                    onClick={() => setMode('oft-oft')}>OFT</button>
                </>
              )}
            </div>
          </div>

          {/* Chain selectors */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">{homeLabel} chain (source) — EID {home.eid}</div>
              <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={home}
                disabledEid={remote.eid}
                onSelect={(c) => { setHomeChain(c); clearData(); setTab('verify'); }} />
            </div>
            <button className="btn btn-sm mb-0.5 flex-shrink-0" title="Swap home ↔ remote"
              onClick={() => {
                setHomeChain(remoteChain ?? remote);
                setRemoteChain(homeChain ?? home);
                const tmpAddr = homeAddr;
                setHomeAddr(remoteAddr);
                setRemoteAddr(tmpAddr);
                clearData();
              }}>⇄</button>
            <div className="flex-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">{remoteLabel} chain (destination) — EID {remote.eid}</div>
              <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={remote}
                disabledEid={home.eid}
                onSelect={(c) => { setRemoteChain(c); clearData(); setTab('verify'); }} />
            </div>
          </div>

          {/* Address inputs */}
          <div className="flex gap-3 items-end mt-3">
            <div className="flex-1">
              <Field label={`${homeLabel} address (source)`} value={homeAddr} onChange={setHomeAddr} />
            </div>
            <div className="w-[34px] flex-shrink-0" /> {/* spacer aligned with swap button above */}
            <div className="flex-1">
              <Field label={`${remoteLabel} address (destination)`} value={remoteAddr} onChange={setRemoteAddr} />
            </div>
          </div>

          {/* Fetch + wallet hints */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {(bothEvm || hasStarknet) && (
              <button
                className="btn btn-primary"
                onClick={handleFetch}
                disabled={fetching || !homeAddr || !remoteAddr}
              >
                {fetching ? 'Fetching…' : 'Fetch Info'}
              </button>
            )}
            {/* EVM wallet status — show for whichever side is EVM */}
            {(() => {
              const evmSide = evmHome ?? evmRemote;
              if (!evmSide) return null;
              return <WalletChainHint isConnected={evm.isConnected} isCorrectChain={evm.chainId === evmSide.chainId}
                chainName={evmSide.name} onSwitch={() => evm.switchNetwork(evmSide.chainId)} />;
            })()}
            {hasStarknet && (
              <WalletChainHint isConnected={stark.isConnected} isCorrectChain={true}
                chainName="Starknet" onSwitch={() => {}} variant="starknet" />
            )}
          </div>

          {/* Token banner */}
          {tokenInfo && (
            <div className="token-banner">
              <TokenBadge label={`Home (${home.name})`} name={tokenInfo.tokenName} symbol={tokenInfo.tokenSymbol} />
              <span className="text-on-surface-variant text-lg">↔</span>
              <TokenBadge label={`Remote (${remote.name})`} name={tokenInfo.peerName} symbol={tokenInfo.peerSymbol} />
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
              <button className={`tab-btn ${tab === 'verify' ? 'tab-btn-active' : ''}`}
                onClick={() => setTab('verify')}>Verify</button>
              <button className={`tab-btn ${tab === 'configure' ? 'tab-btn-active' : ''}`}
                onClick={() => setTab('configure')}>Configure</button>
            </div>
            {tab === 'verify' && bothEvm && evmHome && evmRemote && (
              <VerifyPanel homeChain={evmHome} remoteChain={evmRemote} homeAddress={homeAddr} remoteAddress={remoteAddr} verifying={verifying} result={verifyResult} onVerify={handleVerify} isAdapter={mode === 'bridge-oft'} />
            )}
            {tab === 'verify' && hasStarknet && (
              <StarknetVerifyPanel
                home={home} remote={remote}
                homeAddr={homeAddr} remoteAddr={remoteAddr}
                cairo={cairo} cairoEndpoint={cairoEndpoint}
                readEvmSide={readEvmSideForStarknet}
                evmWalletProvider={walletProviderForHome() ?? walletProviderForRemote()}
                fetchTick={starkFetchTick}
              />
            )}
            {tab === 'configure' && (
              <ConfigureFlow
                home={home} remote={remote}
                homeAddr={homeAddr} remoteAddr={remoteAddr}
                isAdapter={mode === 'bridge-oft'}
                evm={evm} stark={stark}
                wiring={wiring} cairoEndpoint={cairoEndpoint} cairo={cairo}
                verifyResult={verifyResult}
                onRefreshVerify={handleVerify}
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
  // Reset failed state when chain changes so the icon re-attempts loading
  useEffect(() => { setFailed(false); }, [chainKey]);
  if (failed) return <ChainIconFallback size={size} />;
  return (
    <img src={chainIconUrl(chainKey)} alt="" width={size} height={size}
      onError={() => setFailed(true)}
      className="rounded-full flex-shrink-0 object-cover" />
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

function AnyChainSelect({ evmChains, isTestnet, selected, onSelect, disabledEid }: {
  evmChains: LZChain[];
  isTestnet: boolean;
  selected: AnyChain;
  onSelect: (c: AnyChain) => void;
  /** EID to grey out (already selected in the other dropdown) */
  disabledEid?: number;
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

  const snMonogram = <span className="w-[18px] h-[18px] rounded-full bg-[#919bff22] border border-[#919bff55] flex-shrink-0 inline-flex items-center justify-center text-[9px] text-[#919bff] font-bold">SN</span>;

  return (
    <div ref={ref} className="relative">
      <button
        className={`input text-left cursor-pointer flex items-center gap-2 justify-between ${isSelectedStark ? 'border-[#2a2a5a] text-[#919bff]' : ''}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="flex items-center gap-2 truncate">
          {isSelectedStark ? snMonogram : <ChainIcon chainKey={selectedChainKey} size={18} />}
          {displayName}
        </span>
        <span className="text-[11px] text-on-surface-variant ml-2">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="chain-dropdown">
          {/* Starknet option */}
          <div
            className={`chain-option border-b border-outline-variant/10 ${isSelectedStark ? 'chain-option-active' : ''} ${disabledEid === stark.eid ? 'chain-option-disabled' : ''}`}
            onClick={() => { if (disabledEid !== stark.eid) { onSelect(stark); setOpen(false); } }}
          >
            {snMonogram}
            <span className={isSelectedStark ? 'text-[#919bff]' : 'text-[#919bff88]'}>{stark.name}</span>
            <span className="text-[11px] text-on-surface-variant ml-auto">EID {stark.eid}</span>
          </div>

          {/* Search */}
          <div className="p-2 border-b border-outline-variant/10">
            <input ref={inputRef} className="input" placeholder="Search chain or EID…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="overflow-y-auto max-h-[260px]">
            {filteredEvm.length === 0 && (
              <div className="px-3 py-2.5 text-on-surface-variant text-[13px]">No chains match</div>
            )}
            {(['L1', 'L2'] as const).map((cat) => {
              const group = filteredEvm.filter((c) => chainCategory(c) === cat);
              if (group.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="label px-3 pt-2 pb-0.5 mb-0">{cat}</div>
                  {group.map((c) => {
                    const isDisabled = disabledEid === c.eid;
                    return (
                    <div
                      key={c.eid}
                      className={`chain-option ${!isSelectedStark && (selected as LZChain).eid === c.eid ? 'chain-option-active' : ''} ${isDisabled ? 'chain-option-disabled' : ''}`}
                      onClick={() => { if (!isDisabled) { onSelect(toAnyEvm(c)); setOpen(false); } }}
                    >
                      <ChainIcon chainKey={c.chainKey} size={18} />
                      <span>{c.name}</span>
                      <span className="text-[11px] text-on-surface-variant ml-auto">EID {c.eid}</span>
                    </div>
                    );
                  })}
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
  enforcedOptions: string | null;
  peer: string | null;
  dvnSend: import('@/utils/cairoLzConfig').DecodedStarknetUln | null;
  dvnRecv: import('@/utils/cairoLzConfig').DecodedStarknetUln | null;
  executor: import('@/utils/cairoLzConfig').DecodedStarknetExecutor | null;
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

function StarknetVerifyPanel({ home, remote, homeAddr, remoteAddr, cairo, cairoEndpoint, readEvmSide, evmWalletProvider, fetchTick }: {
  home: AnyChain; remote: AnyChain;
  homeAddr: string; remoteAddr: string;
  cairo: ReturnType<typeof useCairoOFT>;
  cairoEndpoint: ReturnType<typeof useCairoEndpoint>;
  readEvmSide: ReturnType<typeof useLZVerify>['readEvmSideForStarknet'];
  evmWalletProvider?: import('ethers').BrowserProvider | null;
  fetchTick?: number;
}): JSX.Element {
  const starkChainData = (isStarknet(home) ? home : remote) as StarknetChain;
  const evmChainData   = (isStarknet(home) ? remote : home) as LZChain & { kind: 'evm' };
  const cairoAddr = isStarknet(home) ? homeAddr : remoteAddr;
  const evmAddr   = isStarknet(home) ? remoteAddr : homeAddr;
  const { resolveName: resolveEvmDvn } = useDVNCatalog(evmChainData.chainKey);

  /** Format a DVN address with its resolved name if known. */
  function dvnLabel(addr: string): string {
    const name = resolveEvmDvn(addr);
    return name ? `${name} (${addr.slice(0, 8)}…${addr.slice(-4)})` : addr;
  }

  const [checking, setChecking] = useState(false);
  const [evmState, setEvmState] = useState<EvmSideState | null>(null);
  const [starkState, setStarkState] = useState<StarkSideState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fetchTick && fetchTick > 0) runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTick]);

  async function runChecks(): Promise<void> {
    if (!isAddr(cairoAddr) || !isAddr(evmAddr)) return;
    setChecking(true); setError(null); setEvmState(null); setStarkState(null);
    try {
      const [evmResult, starkResult] = await Promise.allSettled([
        readEvmSide(evmAddr, starkChainData.eid, evmChainData, evmWalletProvider ?? undefined),
        (async (): Promise<StarkSideState> => {
          const [sendLib, recvLibResult, delegate, enforcedOptions, peerState] = await Promise.all([
            cairoEndpoint.readSendLibrary(starkChainData.endpoint, cairoAddr, evmChainData.eid, starkChainData.rpc),
            cairoEndpoint.readReceiveLibrary(starkChainData.endpoint, cairoAddr, evmChainData.eid, starkChainData.rpc),
            cairoEndpoint.readDelegate(starkChainData.endpoint, cairoAddr, starkChainData.rpc),
            cairo.readEnforcedOptions(cairoAddr, evmChainData.eid, starkChainData.rpc),
            cairo.readPeer(cairoAddr, evmChainData.eid, starkChainData.rpc),
          ]);
          // Read DVN/executor config if send/recv libraries are available
          const [dvnSend, executor, dvnRecv] = await Promise.all([
            sendLib ? cairoEndpoint.readSendUlnConfig(starkChainData.endpoint, cairoAddr, sendLib, evmChainData.eid, starkChainData.rpc) : null,
            sendLib ? cairoEndpoint.readSendExecutorConfig(starkChainData.endpoint, cairoAddr, sendLib, evmChainData.eid, starkChainData.rpc) : null,
            recvLibResult.lib ? cairoEndpoint.readReceiveUlnConfig(starkChainData.endpoint, cairoAddr, recvLibResult.lib, evmChainData.eid, starkChainData.rpc) : null,
          ]);
          return {
            sendLib,
            recvLib: recvLibResult.lib,
            recvLibIsDefault: recvLibResult.isDefault,
            delegate,
            enforcedOptions,
            peer: peerState.peer,
            dvnSend,
            dvnRecv,
            executor,
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
        <div className="flex gap-2">
          {(evmState || starkState) && (
            <button className="btn btn-ghost text-xs" onClick={() => {
              downloadJson({
                exportedAt: new Date().toISOString(),
                oapp: {
                  source: { chain: home.name, address: homeAddr, type: isStarknet(home) ? 'starknet' : 'evm' },
                  destination: { chain: remote.name, address: remoteAddr, type: isStarknet(remote) ? 'starknet' : 'evm' },
                },
                evmSide: evmState ? {
                  sendLib: evmState.sendLib, recvLib: evmState.recvLib, recvLibIsDefault: evmState.recvLibIsDefault,
                  executor: evmState.executor ? { executor: evmState.executor.executor, maxMessageSize: evmState.executor.maxMessageSize } : null,
                  dvnSend: evmState.dvnSend ? { confirmations: String(evmState.dvnSend.confirmations), requiredDVNCount: evmState.dvnSend.requiredDVNCount, requiredDVNs: evmState.dvnSend.requiredDVNs } : null,
                  dvnRecv: evmState.dvnRecv ? { confirmations: String(evmState.dvnRecv.confirmations), requiredDVNCount: evmState.dvnRecv.requiredDVNCount, requiredDVNs: evmState.dvnRecv.requiredDVNs } : null,
                  enforcedOptions: optionsToJson(evmState.enforcedOptions), delegate: evmState.delegate, peer: evmState.peer,
                } : null,
                starknetSide: starkState ? {
                  sendLib: starkState.sendLib, recvLib: starkState.recvLib, recvLibIsDefault: starkState.recvLibIsDefault,
                  executor: starkState.executor ? { executor: starkState.executor.executor, maxMessageSize: starkState.executor.maxMessageSize } : null,
                  dvnSend: starkState.dvnSend ? { confirmations: String(starkState.dvnSend.confirmations), requiredDVNCount: starkState.dvnSend.requiredDVNCount, requiredDVNs: starkState.dvnSend.requiredDVNs } : null,
                  dvnRecv: starkState.dvnRecv ? { confirmations: String(starkState.dvnRecv.confirmations), requiredDVNCount: starkState.dvnRecv.requiredDVNCount, requiredDVNs: starkState.dvnRecv.requiredDVNs } : null,
                  enforcedOptions: optionsToJson(starkState.enforcedOptions), delegate: starkState.delegate, peer: starkState.peer,
                } : null,
                error: error ?? null,
              }, `lz-config-${evmChainData.name.replace(/\s+/g, '-')}-${starkChainData.name.replace(/\s+/g, '-')}-${Date.now()}.json`);
            }}>
              Export config
            </button>
          )}
          <button className="btn btn-primary" onClick={runChecks} disabled={checking || !isAddr(cairoAddr) || !isAddr(evmAddr)}>
            {checking ? 'Checking…' : 'Run checks'}
          </button>
        </div>
      </div>

      {!done && !checking && (
        <p className="text-xs text-on-surface-variant">
          Enter both contract addresses above, then press <strong>Run checks</strong> to read on-chain state from both endpoints. No wallet required.
        </p>
      )}
      {error && <div className="check-row check-critical"><span>{error}</span></div>}

      {/* ── Summary grid (same layout as EVM-EVM) ── */}
      {(evmState || starkState) && (
        <>
          <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1 mt-2">
            EVM → Starknet ({evmChainData.name} → {starkChainData.name})
          </div>
          <div className="verify-summary">
            <SummaryItem label="Send lib (EVM)" value={evmState?.sendLib ?? '—'} />
            <SummaryItem label="Recv lib (SN)" value={starkState?.recvLib ?? '—'} />
            <SummaryItem label="Executor (EVM)" value={evmState?.executor?.executor ?? '—'} />
            <SummaryItem label="DVNs send (EVM)" value={evmState?.dvnSend?.requiredDVNCount ? `${evmState.dvnSend.requiredDVNCount}: ${evmState.dvnSend.requiredDVNs.map(dvnLabel).join(', ')}` : '—'} />
            <SummaryItem label="DVNs recv (SN)" value={starkState?.dvnRecv?.requiredDVNCount ? `${starkState.dvnRecv.requiredDVNCount}: ${starkState.dvnRecv.requiredDVNs.join(', ')}` : '—'} />
          </div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1 mt-3">
            Starknet → EVM ({starkChainData.name} → {evmChainData.name})
          </div>
          <div className="verify-summary">
            <SummaryItem label="Send lib (SN)" value={starkState?.sendLib ?? '—'} />
            <SummaryItem label="Recv lib (EVM)" value={evmState?.recvLib ?? '—'} />
            <SummaryItem label="Executor (SN)" value={starkState?.executor?.executor ?? '—'} />
            <SummaryItem label="DVNs send (SN)" value={starkState?.dvnSend?.requiredDVNCount ? `${starkState.dvnSend.requiredDVNCount}: ${starkState.dvnSend.requiredDVNs.join(', ')}` : '—'} />
            <SummaryItem label="DVNs recv (EVM)" value={evmState?.dvnRecv?.requiredDVNCount ? `${evmState.dvnRecv.requiredDVNCount}: ${evmState.dvnRecv.requiredDVNs.map(dvnLabel).join(', ')}` : '—'} />
          </div>
        </>
      )}

      {/* ── EVM side checks ── */}
      {evmState && (
        <>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant mt-4 mb-1">
            {evmChainData.name} (send → Starknet)
          </div>
          <CheckRow label="Send library set" passed={!!evmState.sendLib && evmState.sendLib !== '0x0000000000000000000000000000000000000000'} detail={evmState.sendLib ?? 'Not set'} />
          <CheckRow label="Executor configured" passed={!!evmState.executor && evmState.executor.executor !== '0x0000000000000000000000000000000000000000'} detail={evmState.executor ? `${evmState.executor.executor} (max ${evmState.executor.maxMessageSize} bytes)` : 'Not configured'} />
          <CheckRow label="DVNs configured (send)" passed={!!evmState.dvnSend && evmState.dvnSend.requiredDVNCount > 0} detail={evmState.dvnSend?.requiredDVNCount ? `${evmState.dvnSend.requiredDVNCount} required: ${evmState.dvnSend.requiredDVNs.map(dvnLabel).join(', ')}` : 'No DVNs set'} />
          <CheckRow label="Enforced options set" passed={!!evmState.enforcedOptions && evmState.enforcedOptions !== '0x'}
            detail={evmState.enforcedOptions && evmState.enforcedOptions !== '0x'
              ? (() => { const d = decodeEnforcedOptions(evmState.enforcedOptions); return d ? `lzReceive gas: ${d.gas}${d.value ? ` + ${d.value} native` : ''}` : evmState.enforcedOptions; })()
              : 'Not set'} />
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
          <CheckRow label="DVNs configured (receive)" passed={!!evmState.dvnRecv && evmState.dvnRecv.requiredDVNCount > 0} detail={evmState.dvnRecv?.requiredDVNCount ? `${evmState.dvnRecv.requiredDVNCount} required: ${evmState.dvnRecv.requiredDVNs.map(dvnLabel).join(', ')}` : 'No DVNs set'} />
        </>
      )}

      {/* ── Starknet side checks ── */}
      {starkState && (
        <>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-tertiary mt-4 mb-1">
            {starkChainData.name} (send → EVM)
          </div>
          <CheckRow label="Send library set" passed={!!starkState.sendLib} detail={starkState.sendLib ?? 'Not set'} />
          <CheckRow label="Executor configured" passed={!!starkState.executor && BigInt(starkState.executor.executor) !== 0n} detail={starkState.executor ? `${starkState.executor.executor} (max ${starkState.executor.maxMessageSize} bytes)` : 'Not configured'} />
          <CheckRow label="DVNs configured (send)" passed={!!starkState.dvnSend && starkState.dvnSend.requiredDVNCount > 0} detail={starkState.dvnSend?.requiredDVNCount ? `${starkState.dvnSend.requiredDVNCount} required: ${starkState.dvnSend.requiredDVNs.join(', ')}` : 'No DVNs set'} />
          {starkState.dvnSend && starkState.dvnSend.requiredDVNCount > 0 && starkState.dvnSend.requiredDVNCount < 2 && (
            <CheckRow label="DVN count ≥ 2 (mainnet recommendation)" passed={false} detail={`Only ${starkState.dvnSend.requiredDVNCount} DVN configured. Use ≥ 2 for mainnet.`} severity="warning" />
          )}
          {starkState.dvnSend && (
            <CheckRow label="Block confirmations set" passed={starkState.dvnSend.confirmations > 0n} detail={starkState.dvnSend.confirmations > 0n ? `${starkState.dvnSend.confirmations} blocks` : 'Using default (0)'} severity="warning" />
          )}
          <CheckRow label="Enforced options set" passed={!!starkState.enforcedOptions}
            detail={starkState.enforcedOptions
              ? (() => { const d = decodeEnforcedOptions(starkState.enforcedOptions); return d ? `lzReceive gas: ${d.gas}${d.value ? ` + ${d.value} native` : ''}` : starkState.enforcedOptions; })()
              : 'Not set'} />
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
          <CheckRow label="DVNs configured (receive)" passed={!!starkState.dvnRecv && starkState.dvnRecv.requiredDVNCount > 0} detail={starkState.dvnRecv?.requiredDVNCount ? `${starkState.dvnRecv.requiredDVNCount} required: ${starkState.dvnRecv.requiredDVNs.join(', ')}` : 'No DVNs set'} />
        </>
      )}
    </section>
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
          <div className="text-[11px] text-on-surface-variant mt-0.5">{chainName || 'select source chain'}</div>
        </div>
        <button
          className="btn btn-primary text-[12px] py-1 px-2.5"
          disabled={!canScan || scanning}
          onClick={onScan}
          title={!canScan ? 'Enter a contract address and select source chain first' : ''}
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

  let displayPeer = entry.peer ?? '—';
  if (isSet && isStarknetEid && entry.peer) {
    const felt = BigInt(entry.peer);
    displayPeer = '0x' + felt.toString(16);
  } else if (isSet && entry.peer) {
    displayPeer = '0x' + entry.peer.slice(-40);
  }

  const snMonogram = <span className="w-[16px] h-[16px] rounded-full bg-[#919bff22] border border-[#919bff55] flex-shrink-0 inline-flex items-center justify-center text-[8px] text-[#919bff] font-bold">SN</span>;

  return (
    <div className={`flex flex-col gap-0.5 p-2 mb-1.5 rounded-lg border ${isSet ? 'bg-secondary/5 border-secondary/20' : 'bg-surface-container border-outline-variant/10 opacity-40'}`}>
      <div className="flex items-center justify-between">
        <span className={`text-[13px] font-semibold flex items-center gap-1.5 ${isSet ? 'text-on-surface' : 'text-on-surface-variant'}`}>
          {isStarknetEid ? snMonogram : entry.chainKey ? <ChainIcon chainKey={entry.chainKey} size={16} /> : <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSet ? 'bg-secondary' : 'bg-outline-variant'}`} />}
          {entry.name}
        </span>
        <span className="text-[10px] text-on-surface-variant">EID {entry.eid}</span>
      </div>
      {isSet && (
        <div className="font-mono text-[11px] text-secondary break-all pl-[22px]">
          {displayPeer.slice(0, 14)}…{displayPeer.slice(-8)}
        </div>
      )}
      {entry.error && (
        <div className="text-[10px] text-error pl-[22px]">read error</div>
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

// ── Config export helpers ─────────────────────────────────────────────────────

function ulnToJson(uln: UlnConfig | null) {
  if (!uln) return null;
  return { confirmations: String(uln.confirmations), requiredDVNCount: uln.requiredDVNCount, optionalDVNCount: uln.optionalDVNCount, optionalDVNThreshold: uln.optionalDVNThreshold, requiredDVNs: uln.requiredDVNs, optionalDVNs: uln.optionalDVNs };
}

function executorToJson(ex: ExecutorConfig | null) {
  if (!ex) return null;
  return { maxMessageSize: ex.maxMessageSize, executor: ex.executor };
}

function optionsToJson(hex: string | null) {
  if (!hex || hex === '0x') return null;
  const decoded = decodeEnforcedOptions(hex);
  return decoded ? { raw: hex, lzReceiveGas: decoded.gas, ...(decoded.value ? { nativeValue: decoded.value } : {}) } : hex;
}

function exportEvmConfig(result: PathwayVerifyResult, homeLabel: string, remoteLabel: string, homeAddress: string, remoteAddress: string) {
  downloadJson({
    exportedAt: new Date().toISOString(),
    oapp: { source: { chain: homeLabel, address: homeAddress }, destination: { chain: remoteLabel, address: remoteAddress } },
    'A_to_B': {
      home_send: { sendLib: result.homeSendLib, executor: executorToJson(result.homeExecutor), dvn: ulnToJson(result.homeDVN), delegate: result.homeDelegate, peer: result.homePeer, enforcedOptions: optionsToJson(result.homeEnforcedOptions), rateLimit: result.homeRateLimit ? { limit: String(result.homeRateLimit.limit), window: result.homeRateLimit.window } : null },
      remote_receive: { receiveLib: result.remoteReceiveLib, receiveLibIsDefault: result.remoteReceiveLibIsDefault, dvn: ulnToJson(result.remoteDVN), peer: result.remotePeer, enforcedOptions: optionsToJson(result.remoteEnforcedOptions) },
    },
    'B_to_A': {
      remote_send: { sendLib: result.remoteSendLib, executor: executorToJson(result.remoteExecutor), dvn: ulnToJson(result.remoteSendDVN), delegate: result.remoteDelegate },
      home_receive: { receiveLib: result.homeReceiveLib, receiveLibIsDefault: result.homeReceiveLibIsDefault, dvn: ulnToJson(result.homeReceiveDVN) },
    },
    checks: result.checks.map((c) => ({ label: c.label, passed: c.passed, severity: c.severity, detail: c.detail })),
  }, `lz-config-${homeLabel.replace(/\s+/g, '-')}-${remoteLabel.replace(/\s+/g, '-')}-${Date.now()}.json`);
}

// ── Verify panel ──────────────────────────────────────────────────────────────

function VerifyPanel({ homeChain, remoteChain, homeAddress, remoteAddress, verifying, result, onVerify, isAdapter = true }: {
  homeChain: LZChain; remoteChain: LZChain;
  homeAddress: string; remoteAddress: string;
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
            {homeChain.name} ↔ {remoteChain.name} — bidirectional
          </span>
        </div>
        <div className="flex gap-2">
          {result && !result.error && (
            <button className="btn btn-ghost text-xs" onClick={() => exportEvmConfig(result, homeChain.name, remoteChain.name, homeAddress, remoteAddress)}>
              Export config
            </button>
          )}
          <button className="btn" onClick={onVerify} disabled={verifying}>
            {verifying ? 'Checking…' : 'Re-run checks'}
          </button>
        </div>
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
          <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1 mt-2">A → B ({homeChain.name} → {remoteChain.name})</div>
          <div className="verify-summary">
            <SummaryItem label="Send lib" value={result.homeSendLib ?? '—'} />
            <SummaryItem label="Recv lib" value={result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : '—'} />
            <SummaryItem label="Executor" value={result.homeExecutor?.executor ?? '—'} />
            <SummaryItem label="Confirmations" value={result.homeDVN ? `${result.homeDVN.confirmations} blocks` : '—'} />
          </div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1 mt-3">B → A ({remoteChain.name} → {homeChain.name})</div>
          <div className="verify-summary">
            <SummaryItem label="Send lib" value={result.remoteSendLib ?? '—'} />
            <SummaryItem label="Recv lib" value={result.homeReceiveLib ? `${result.homeReceiveLib}${result.homeReceiveLibIsDefault ? ' (default)' : ''}` : '—'} />
            <SummaryItem label="Executor" value={result.remoteExecutor?.executor ?? '—'} />
            <SummaryItem label="Confirmations" value={result.remoteSendDVN ? `${result.remoteSendDVN.confirmations} blocks` : '—'} />
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
                <RawRow label="Enforced options" value={result.homeEnforcedOptions && result.homeEnforcedOptions !== '0x' ? (() => { const d = decodeEnforcedOptions(result.homeEnforcedOptions); return d ? `lzReceive gas: ${d.gas}${d.value ? ` + ${d.value} native` : ''} (${result.homeEnforcedOptions})` : result.homeEnforcedOptions; })() : result.homeEnforcedOptions} />
                <RawRow label="Peer bytes32" value={result.homePeer} />
                <RawRow label="Delegate" value={result.homeDelegate} />
                {isAdapter && result.homeRateLimit !== undefined && (
                  <RawRow label="Rate limit" value={result.homeRateLimit ? `${String(result.homeRateLimit.limit)} / ${result.homeRateLimit.window}s` : 'none'} />
                )}
              </RawSection>
              <RawSection title={`${remoteChain.name} — A→B receive side`}>
                <RawRow label="EID" value={String(remoteChain.eid)} />
                <RawRow label="Receive library" value={result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : null} />
                <RawRow label="DVNs (required)" value={result.remoteDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveRemote)).join('\n') ?? null} />
                <RawRow label="Confirmations" value={result.remoteDVN?.confirmations != null ? String(result.remoteDVN.confirmations) : null} />
                <RawRow label="Enforced options" value={result.remoteEnforcedOptions && result.remoteEnforcedOptions !== '0x' ? (() => { const d = decodeEnforcedOptions(result.remoteEnforcedOptions); return d ? `lzReceive gas: ${d.gas}${d.value ? ` + ${d.value} native` : ''} (${result.remoteEnforcedOptions})` : result.remoteEnforcedOptions; })() : result.remoteEnforcedOptions} />
                <RawRow label="Peer bytes32" value={result.remotePeer} />
              </RawSection>
              <RawSection title={`${remoteChain.name} — B→A send side`}>
                <RawRow label="Send library" value={result.remoteSendLib} />
                <RawRow label="Executor" value={result.remoteExecutor?.executor} />
                <RawRow label="DVNs (required)" value={result.remoteSendDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveRemote)).join('\n') ?? null} />
                <RawRow label="Confirmations" value={result.remoteSendDVN?.confirmations != null ? String(result.remoteSendDVN.confirmations) : null} />
                <RawRow label="Delegate" value={result.remoteDelegate} />
              </RawSection>
              <RawSection title={`${homeChain.name} — B→A receive side`}>
                <RawRow label="Receive library" value={result.homeReceiveLib ? `${result.homeReceiveLib}${result.homeReceiveLibIsDefault ? ' (default)' : ''}` : null} />
                <RawRow label="DVNs (required)" value={result.homeReceiveDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveHome)).join('\n') ?? null} />
                <RawRow label="Confirmations" value={result.homeReceiveDVN?.confirmations != null ? String(result.homeReceiveDVN.confirmations) : null} />
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
