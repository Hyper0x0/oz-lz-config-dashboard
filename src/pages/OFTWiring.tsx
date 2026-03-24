import { useState, useRef, useEffect } from 'react';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { useOFTWiring } from '@/hooks/useOFTWiring';
import { useLZVerify } from '@/hooks/useLZVerify';
import { useLZChains } from '@/hooks/useLZChains';
import { useCairoOFT } from '@/hooks/useCairoOFT';
import { useCairoEndpoint } from '@/hooks/useCairoEndpoint';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import { EvmWalletButton } from '@/components/EvmWalletButton';
import { StarknetWalletButton } from '@/components/StarknetWalletButton';
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
  return { kind: 'starknet', isTestnet: testnet, ...base };
}

export function OFTWiring(): JSX.Element {
  const evm = useEvmWallet();
  const stark = useStarknetWallet();
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

  return (
    <div>
      {/* Topbar — both wallet buttons together */}
      <div className="topbar">
        <h2>OFT Wiring</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <EvmWalletButton
            address={evm.address}
            chainId={evm.chainId}
            chainName={evmHome?.name ?? ''}
            onConnect={evm.connect}
            onSwitchNetwork={evmHome ? () => evm.switchNetwork(evmHome.chainId) : undefined}
            targetChainId={evmHome?.chainId ?? 0}
          />
          {hasStarknet && (
            <StarknetWalletButton
              address={stark.address}
              onConnect={stark.connect}
              onDisconnect={stark.disconnect}
            />
          )}
        </div>
      </div>

      {/* Page body: main content left, peers sidebar right */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>

      {/* Chain + contract picker */}
      <section className="card">

        {/* Network toggle + wiring mode */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <button className={`btn${isTestnet ? '' : ' btn-ghost'}`} onClick={() => handleNetworkToggle(true)}>Testnet</button>
          <button className={`btn${!isTestnet ? '' : ' btn-ghost'}`} onClick={() => handleNetworkToggle(false)}>Mainnet</button>
          {chainsLoading && <span style={{ fontSize: 12, color: '#888' }}>Loading chains…</span>}
          {!chainsLoading && <span style={{ fontSize: 12, color: '#555' }}>{evmChains.length} EVM + 1 Starknet</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#555' }}>Wire:</span>
            <button className={`btn${mode === 'bridge-oft' ? '' : ' btn-ghost'}`} onClick={() => setMode('bridge-oft')}>Adapter ↔ OFT</button>
            <button className={`btn${mode === 'oft-oft' ? '' : ' btn-ghost'}`} onClick={() => setMode('oft-oft')}>OFT ↔ OFT</button>
          </div>
        </div>

        {/* Chain selectors */}
        <div className="form-grid">
          <div>
            <div className="label">{homeLabel} chain (home) — EID {home.eid}</div>
            <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={home}
              onSelect={(c) => { setHomeChain(c); clearData(); setTab('verify'); }} />
          </div>
          <div>
            <div className="label">OFT chain (remote) — EID {remote.eid}</div>
            <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={remote}
              onSelect={(c) => { setRemoteChain(c); clearData(); setTab('verify'); }} />
          </div>
        </div>

        {/* Address inputs */}
        <div className="form-grid" style={{ marginTop: 8 }}>
          <Field label={`${homeLabel} address (home)`} value={homeAddr} onChange={setHomeAddr} />
          <Field label="OFT address (remote)" value={remoteAddr} onChange={setRemoteAddr} />
        </div>

        {/* Fetch + wallet hints */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
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
            <span style={{ fontSize: 12, color: '#6bcb77' }}>✓ EVM wallet on {evmHome.name}</span>
          )}
          {evmHome && evm.isConnected && evm.chainId !== evmHome.chainId && (
            <span style={{ fontSize: 12, color: '#888' }}>Using public RPC — switch wallet to {evmHome.name} to configure</span>
          )}
          {hasStarknet && stark.isConnected && (
            <span style={{ fontSize: 12, color: '#6bcb77' }}>✓ Starknet wallet connected</span>
          )}
          {hasStarknet && !stark.isConnected && (
            <span style={{ fontSize: 12, color: '#888' }}>Connect Starknet wallet to configure</span>
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
          <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 8 }}>{tokenInfoError}</div>
        )}
      </section>

      {/* Verify + Configure tabs — shown for all chain combinations */}
      {(bothEvm || hasStarknet) && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className={`btn${tab === 'verify' ? '' : ' btn-ghost'}`} onClick={() => setTab('verify')}>Verify</button>
            <button className={`btn${tab === 'configure' ? '' : ' btn-ghost'}`} onClick={() => setTab('configure')}>Configure</button>
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
      <div style={{ width: 300, flexShrink: 0, position: 'sticky', top: 16 }}>
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

      </div>{/* end flex row */}
    </div>
  );
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
  const displayName = `${selected.name} — EID ${selected.eid}`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="input"
        style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          ...(isSelectedStark ? { borderColor: '#3a2010', color: '#ff7e33' } : {}) }}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span>{displayName}</span>
        <span style={{ color: '#555', fontSize: 11, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="chain-dropdown">
          {/* Starknet option pinned at top */}
          <div
            className={`chain-option${isSelectedStark ? ' chain-option-active' : ''}`}
            style={{ borderBottom: '1px solid #2a2a2a', color: isSelectedStark ? '#ff7e33' : '#ff7e33aa' }}
            onClick={() => { onSelect(stark); setOpen(false); }}
          >
            <span>{stark.name}</span>
            <span style={{ fontSize: 11 }}>EID {stark.eid}</span>
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
          <div style={{ overflowY: 'auto', maxHeight: 220 }}>
            {filteredEvm.length === 0 && (
              <div style={{ padding: '10px 12px', color: '#555', fontSize: 13 }}>No chains match</div>
            )}
            {filteredEvm.map((c) => (
              <div
                key={c.eid}
                className={`chain-option${!isSelectedStark && (selected as LZChain).eid === c.eid ? ' chain-option-active' : ''}`}
                onClick={() => { onSelect(toAnyEvm(c)); setOpen(false); }}
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
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {detail && <div style={{ fontSize: 12, opacity: 0.8, wordBreak: 'break-all' }}>{detail}</div>}
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
    <section className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Pathway verification</h3>
          <span style={{ color: '#888', fontSize: 13 }}>
            {home.name} (EID {home.eid}) ↔ {remote.name} (EID {remote.eid})
          </span>
        </div>
        <button className="btn btn-primary" onClick={runChecks} disabled={checking || !isAddr(cairoAddr) || !isAddr(evmAddr)}>
          {checking ? 'Checking…' : 'Run checks'}
        </button>
      </div>

      {!done && !checking && (
        <p style={{ color: '#666', fontSize: 13 }}>
          Enter both contract addresses above, then press <strong>Run checks</strong> to read on-chain state from both endpoints. No wallet required.
        </p>
      )}
      {error && <div className="check-row check-critical"><span>{error}</span></div>}

      {/* ── EVM side ── */}
      {evmState && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }}>
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
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }}>
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
          <div style={{ fontSize: 11, fontWeight: 700, color: '#ff7e33', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }}>
            {starkChainData.name} (send → EVM)
          </div>
          <CheckRow label="Send library set" passed={!!starkState.sendLib} detail={starkState.sendLib ?? 'Not set'} />
          <CheckRow label="Enforced options set" passed={starkState.enforcedOptions} detail={starkState.enforcedOptions ? 'Set' : 'Not set'} />
          <CheckRow label="Delegate set" passed={!!starkState.delegate} detail={starkState.delegate ?? 'Not set'} severity="warning" />
          <CheckRow label="Peer set (Starknet → EVM)"
            passed={!!starkState.peer && starkState.peer !== ZERO64 && expectedCairoPeer !== null && starkState.peer.toLowerCase() === expectedCairoPeer.toLowerCase()}
            detail={starkState.peer && starkState.peer !== ZERO64 ? starkState.peer : 'Not set'} />
          <div style={{ fontSize: 11, fontWeight: 700, color: '#ff7e33', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingLeft: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#555' }}>{label}</span>
      <span style={{ fontSize: 12, color: '#888' }}>{chainName} — EID {eid}</span>
      {connected
        ? <span style={{ fontSize: 11, color: '#6bcb77', marginLeft: 'auto' }}>✓ connected</span>
        : <span style={{ fontSize: 11, color: '#666', marginLeft: 'auto' }}>wallet needed</span>}
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
    <div className="card" style={{ marginTop: 16, borderColor: confirmed ? '#2a3a2a' : '#2a2a2a' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Connect Peers</div>
        <div className="step-warn-banner">
          ⚠ Setting peers opens the messaging channel. Tokens can flow immediately. Complete all configuration steps on both sides first.
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Both sides are fully configured and the addresses above are correct.
      </label>
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Left side peer */}
        <div style={{ flex: 1 }}>
          <div className="label">{left.peerLabel}</div>
          <div className="mono-block" style={{ marginBottom: 8 }}>{left.peerBytes32 || '(enter address above)'}</div>
          {left.chainId > 0 && left.connectedChainId !== left.chainId && (
            <button className="btn" style={{ fontSize: 11, padding: '3px 10px', marginBottom: 6 }} onClick={left.onSwitch}>
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
          <div style={{ marginTop: 6 }}><TxStatus state={leftTx} /></div>
        </div>
        {/* Right side peer */}
        <div style={{ flex: 1 }}>
          <div className="label">{right.peerLabel}</div>
          <div className="mono-block" style={{ marginBottom: 8 }}>{right.peerBytes32 || '(enter address above)'}</div>
          {right.chainId > 0 && right.connectedChainId !== right.chainId && (
            <button className="btn" style={{ fontSize: 11, padding: '3px 10px', marginBottom: 6 }} onClick={right.onSwitch}>
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
          <div style={{ marginTop: 6 }}><TxStatus state={rightTx} /></div>
        </div>
      </div>
    </div>
  );
}

// ── EVM-EVM configure panel (side-by-side) ────────────────────────────────────

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

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Home column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChainColumnHeader label="EVM" chainName={homeChain.name} eid={homeChain.eid} connected={homeConnected} />
          <GuidedConfigure
            homeChain={homeChain} remoteChain={remoteChain}
            adapterAddr={homeAddr} peerAddr={remoteAddr}
            connectedChainId={evm.chainId} isConnected={evm.isConnected}
            signer={evm.signer} onSwitchNetwork={evm.switchNetwork}
            wiring={wiring} verifyResult={verifyResult}
            isAdapter={isAdapter} isRemoteEvm={false} hidePeerStep
          />
        </div>
        {/* Remote column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChainColumnHeader label="EVM" chainName={remoteChain.name} eid={remoteChain.eid} connected={remoteConnected} />
          <GuidedConfigure
            homeChain={remoteChain} remoteChain={homeChain}
            adapterAddr={remoteAddr} peerAddr={homeAddr}
            connectedChainId={evm.chainId} isConnected={evm.isConnected}
            signer={evm.signer} onSwitchNetwork={evm.switchNetwork}
            wiring={wiring} verifyResult={null}
            isAdapter={false} isRemoteEvm={false} hidePeerStep
          />
        </div>
      </div>

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
  const starkHint = !starkConnected ? <span style={{ fontSize: 12, color: '#888' }}>Connect Starknet wallet first</span> : null;

  // Starknet accordion
  const [openStarkStep, setOpenStarkStep] = useState<number | null>(1);
  const toggleStark = (n: number) => setOpenStarkStep((p) => (p === n ? null : n));

  // Tx states
  const [enforcedOptsTx, setEnforcedOptsTx] = useState<TxState>({ status: 'idle' });
  const [libTx,          setLibTx]          = useState<TxState>({ status: 'idle' });
  const [sendConfigTx,   setSendConfigTx]   = useState<TxState>({ status: 'idle' });
  const [executorTx,     setExecutorTx]     = useState<TxState>({ status: 'idle' });
  const [recvConfigTx,   setRecvConfigTx]   = useState<TxState>({ status: 'idle' });
  const [delegateTx,     setDelegateTx]     = useState<TxState>({ status: 'idle' });

  // Field state
  const [cairoGas,         setCairoGas]         = useState('80000');
  const [cairoLib,         setCairoLib]         = useState(starkChainData.sendLib ?? '');
  const [cairoGracePeriod, setCairoGracePeriod] = useState('0');
  const [cairoConfirm,     setCairoConfirm]     = useState(starkChainData.isTestnet ? '1' : '15');
  const [cairoDelegate,    setCairoDelegate]    = useState('');
  const [cairoExecutor,    setCairoExecutor]    = useState(starkChainData.executor ?? '');
  const [cairoMaxMsgSize,  setCairoMaxMsgSize]  = useState('10000');

  const [sendDvns, setSendDvns] = useState<Map<string, DVNProvider>>(new Map());
  const [recvDvns, setRecvDvns] = useState<Map<string, DVNProvider>>(new Map());
  const { dvns: availableDvns, loading: dvnsLoading } = useDVNCatalog(starkChainData.chainKey);

  function toggleDvn(side: 'send' | 'recv', addr: string, provider: DVNProvider) {
    const setter = side === 'send' ? setSendDvns : setRecvDvns;
    setter((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, provider); return next; });
  }

  // EVM column is always left, Starknet always right (symmetric regardless of home/remote)
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* ── EVM column (left) ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChainColumnHeader label="EVM" chainName={evmChainData.name} eid={evmChainData.eid} connected={evmConnected} />
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChainColumnHeader label="Starknet" chainName={starkChainData.name} eid={starkChainData.eid} connected={starkConnected} />

          {/* Step 1 — Enforced Options */}
          <CairoStepCard n={1} title="Enforced Options" subtitle="Set minimum gas for lzReceive on the Starknet OFT."
            open={openStarkStep === 1} onToggle={() => toggleStark(1)}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <div className="label">Gas limit</div>
                <input className="input" value={cairoGas} onChange={(e) => setCairoGas(e.target.value)} style={{ width: 140 }} />
              </div>
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr}
                onClick={async () => { setEnforcedOptsTx({ status: 'pending' }); setEnforcedOptsTx(await cairoEndpoint.setEnforcedOptions(cairoAddr, evmChainData.eid, BigInt(cairoGas), starkChainData.rpc)); }}>
                Set on Starknet OFT
              </button>
              {starkHint}
            </div>
            <TxStatus state={enforcedOptsTx} />
          </CairoStepCard>

          {/* Step 2 — Message Libraries */}
          <CairoStepCard n={2} title="Message Libraries" subtitle="Set send &amp; receive library. On Starknet both use the same address."
            open={openStarkStep === 2} onToggle={() => toggleStark(2)}>
            <p className="step-hint">SendUln302 and ReceiveUln302 are the same contract on Starknet — one address sets both directions.</p>
            {starkChainData.sendLib && (
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                Known lib: <span style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 11 }}>{starkChainData.sendLib}</span>
              </div>
            )}
            <div style={{ marginBottom: 8 }}>
              <div className="label">Library address (ULN302)</div>
              <input className="input" value={cairoLib} onChange={(e) => setCairoLib(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Grace period (blocks, 0 = immediate)</div>
              <input className="input" value={cairoGracePeriod} onChange={(e) => setCairoGracePeriod(e.target.value)} style={{ width: 120 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr || !cairoLib}
                onClick={async () => { setLibTx({ status: 'pending' }); setLibTx(await cairoEndpoint.setLibraries(starkChainData.endpoint, cairoAddr, evmChainData.eid, cairoLib, Number(cairoGracePeriod), starkChainData.rpc)); }}>
                Set Send &amp; Receive Library
              </button>
              {starkHint}
            </div>
            <TxStatus state={libTx} />
          </CairoStepCard>

          {/* Step 3 — DVN Send Config */}
          <CairoStepCard n={3} title="DVN Send Config" subtitle="Select DVNs and set ULN send config on the Starknet Endpoint."
            open={openStarkStep === 3} onToggle={() => toggleStark(3)}>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Library address (from step 2)</div>
              <input className="input" value={cairoLib} onChange={(e) => setCairoLib(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Required DVNs</div>
              <CairoDVNPicker dvns={availableDvns} loading={dvnsLoading} selected={sendDvns} onToggle={(a, p) => toggleDvn('send', a, p)} />
              {sendDvns.size === 0 && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Select at least one DVN</div>}
            </div>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Block confirmations</div>
              <input className="input" value={cairoConfirm} onChange={(e) => setCairoConfirm(e.target.value)} style={{ width: 100 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr || !cairoLib || sendDvns.size === 0}
                onClick={async () => {
                  setSendConfigTx({ status: 'pending' });
                  setSendConfigTx(await cairoEndpoint.setUlnSendConfig(starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid,
                    { confirmations: Number(cairoConfirm), requiredDvns: sortDvns([...sendDvns.keys()]) }, starkChainData.rpc));
                }}>Set DVN Send Config</button>
              {starkHint}
            </div>
            <TxStatus state={sendConfigTx} />
          </CairoStepCard>

          {/* Step 4 — Executor Config */}
          <CairoStepCard n={4} title="Executor Config" subtitle="Set max message size and executor address."
            open={openStarkStep === 4} onToggle={() => toggleStark(4)}>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Library address (from step 2)</div>
              <input className="input" value={cairoLib} onChange={(e) => setCairoLib(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Executor address</div>
              <input className="input" value={cairoExecutor} onChange={(e) => setCairoExecutor(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Max message size (bytes)</div>
              <input className="input" value={cairoMaxMsgSize} onChange={(e) => setCairoMaxMsgSize(e.target.value)} style={{ width: 120 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr || !cairoLib || !cairoExecutor}
                onClick={async () => {
                  setExecutorTx({ status: 'pending' });
                  setExecutorTx(await cairoEndpoint.setExecutorConfig(starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid,
                    { maxMessageSize: Number(cairoMaxMsgSize), executor: cairoExecutor }, starkChainData.rpc));
                }}>Set Executor Config</button>
              {starkHint}
            </div>
            <TxStatus state={executorTx} />
          </CairoStepCard>

          {/* Step 5 — DVN Receive Config */}
          <CairoStepCard n={5} title="DVN Receive Config" subtitle="Select DVNs and set ULN receive config on the Starknet Endpoint."
            open={openStarkStep === 5} onToggle={() => toggleStark(5)}>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Library address (from step 2)</div>
              <input className="input" value={cairoLib} onChange={(e) => setCairoLib(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Required DVNs</div>
              <CairoDVNPicker dvns={availableDvns} loading={dvnsLoading} selected={recvDvns} onToggle={(a, p) => toggleDvn('recv', a, p)} />
              {recvDvns.size === 0 && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Select at least one DVN</div>}
            </div>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Block confirmations</div>
              <input className="input" value={cairoConfirm} onChange={(e) => setCairoConfirm(e.target.value)} style={{ width: 100 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr || !cairoLib || recvDvns.size === 0}
                onClick={async () => {
                  setRecvConfigTx({ status: 'pending' });
                  setRecvConfigTx(await cairoEndpoint.setUlnReceiveConfig(starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid,
                    { confirmations: Number(cairoConfirm), requiredDvns: sortDvns([...recvDvns.keys()]) }, starkChainData.rpc));
                }}>Set DVN Receive Config</button>
              {starkHint}
            </div>
            <TxStatus state={recvConfigTx} />
          </CairoStepCard>

          {/* Step 6 — Delegate */}
          <CairoStepCard n={6} title="Delegate" subtitle="Allow a delegate to configure the endpoint on behalf of this OFT."
            open={openStarkStep === 6} onToggle={() => toggleStark(6)}>
            <p className="step-hint">Required before configuring the endpoint from an external account.</p>
            <div style={{ marginBottom: 8 }}>
              <div className="label">Delegate address</div>
              <input className="input" value={cairoDelegate} onChange={(e) => setCairoDelegate(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={!starkConnected || !cairoAddr || !cairoDelegate}
                onClick={async () => { setDelegateTx({ status: 'pending' }); setDelegateTx(await cairoEndpoint.setDelegate(cairoAddr, cairoDelegate, starkChainData.rpc)); }}>
                Set Delegate
              </button>
              {starkHint}
            </div>
            <TxStatus state={delegateTx} />
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
  if (loading) return <div style={{ fontSize: 12, color: '#888' }}>Loading DVNs…</div>;
  if (dvns.length === 0) return (
    <div style={{ fontSize: 12, color: '#888' }}>No DVNs found for this chain. Enter addresses manually if needed.</div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {dvns.map((p) => {
        const addr = p.address.toLowerCase();
        const checked = selected.has(addr);
        const initials = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        return (
          <label key={p.address} style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            padding: '6px 8px', borderRadius: 5,
            background: checked ? p.color + '15' : 'transparent',
            border: `1px solid ${checked ? p.color + '66' : '#222'}`,
          }}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(addr, p)} />
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: '50%',
              background: p.color + '33', border: `1px solid ${p.color}`,
              color: p.color, fontSize: 9, fontWeight: 700, flexShrink: 0,
            }}>{initials}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{p.address.slice(0, 12)}…{p.address.slice(-6)}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function CairoStepCard({ n, title, subtitle, open, onToggle, children }: {
  n: number; title: string; subtitle: string;
  open: boolean; onToggle: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`step-card${open ? ' step-card-open' : ''}`} style={{ marginTop: 6 }}>
      <button className="step-header" onClick={onToggle}>
        <span className="step-num">{n}</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{subtitle}</div>
        </div>
        <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="step-body">{children}</div>}
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
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Connected Peers</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{chainName || 'select home chain'}</div>
        </div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '4px 10px' }}
          disabled={!canScan || scanning}
          onClick={onScan}
          title={!canScan ? 'Enter a contract address and select home chain first' : ''}
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {!peers && !scanning && !error && (
        <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: '20px 0' }}>
          Enter a contract address above and press <strong>Scan</strong> to discover all connected chains.
        </div>
      )}

      {scanning && (
        <div style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: '20px 0' }}>
          Querying {isTestnet ? 'testnet' : 'mainnet'} chains…
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#ff6b6b', wordBreak: 'break-all' }}>Error: {error}</div>
      )}

      {peers && !scanning && (
        <>
          {/* Summary */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 12 }}>
            <span style={{ color: '#6bcb77', fontWeight: 600 }}>{connected.length} connected</span>
            <span style={{ color: '#555' }}>/ {peers.length} checked</span>
          </div>

          {/* Adapter address */}
          <div style={{ marginBottom: 10, padding: '6px 8px', background: '#0e0e1a', borderRadius: 5, border: '1px solid #2a2a3a' }}>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{bridgeLabel}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#aaa', wordBreak: 'break-all' }}>{bridgeAddr}</div>
          </div>

          {/* Connected peers */}
          {connected.length === 0 && (
            <div style={{ fontSize: 12, color: '#666', textAlign: 'center', padding: '8px 0' }}>No peers set</div>
          )}
          {connected.map((p) => (
            <PeerRow key={p.eid} entry={p} />
          ))}

          {/* Unset chains toggle */}
          {unset.length > 0 && (
            <>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, width: '100%', marginTop: 8, justifyContent: 'center' }}
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
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      padding: '8px 10px', marginBottom: 6,
      background: isSet ? '#0a120a' : '#0e0e0e',
      border: `1px solid ${isSet ? '#1a3a1a' : '#1a1a1a'}`,
      borderRadius: 6,
      opacity: isSet ? 1 : 0.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: isSet ? '#ccc' : '#555' }}>
          <span style={{ marginRight: 6, fontSize: 10 }}>{isSet ? '🟢' : '⚪'}</span>
          {entry.name}
        </span>
        <span style={{ fontSize: 10, color: '#555' }}>EID {entry.eid}</span>
      </div>
      {isSet && (
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#7a9c7a', wordBreak: 'break-all' }}>
          {displayPeer.slice(0, 14)}…{displayPeer.slice(-8)}
        </div>
      )}
      {entry.error && (
        <div style={{ fontSize: 10, color: '#ff6b6b' }}>read error</div>
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
