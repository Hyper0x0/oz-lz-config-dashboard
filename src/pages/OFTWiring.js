import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useOFTWiring } from '@/hooks/useOFTWiring';
import { useLZVerify } from '@/hooks/useLZVerify';
import { useLZChains } from '@/hooks/useLZChains';
import { useCairoOFT } from '@/hooks/useCairoOFT';
import { useCairoEndpoint } from '@/hooks/useCairoEndpoint';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import { TxStatus } from '@/components/TxStatus';
import { GuidedConfigure } from '@/components/GuidedConfigure';
import { CONTRACTS, STARKNET_TESTNET, STARKNET_MAINNET } from '@/config/chains';
import { isStarknet, isEvm } from '@/config/lzCatalog';
import { sortDvns } from '@/utils/cairoLzConfig';
/** Returns false for '', '0x', or any string that would throw BigInt(). */
function isAddr(s) { return s.length > 2 && s !== '0x'; }
/** Safe bytes32 display from a hex address string. */
function addrToBytes32(addr) { return '0x' + BigInt(addr).toString(16).padStart(64, '0'); }
function toAnyEvm(c) { return { ...c, kind: 'evm' }; }
function starkChain(testnet) {
    const base = testnet ? STARKNET_TESTNET : STARKNET_MAINNET;
    // Apply RPC override from settings (stored in localStorage)
    try {
        const stored = localStorage.getItem('ozlz_rpc_overrides');
        if (stored) {
            const overrides = JSON.parse(stored);
            const override = testnet ? overrides.starknetSepolia : overrides.starknetMainnet;
            if (override?.trim())
                return { kind: 'starknet', isTestnet: testnet, ...base, rpc: override.trim() };
        }
    }
    catch { /* ignore */ }
    return { kind: 'starknet', isTestnet: testnet, ...base };
}
export function OFTWiring() {
    const { evm, stark } = useWallet();
    const { chains: evmChains, loading: chainsLoading, isTestnet, setIsTestnet } = useLZChains(true);
    const wiring = useOFTWiring(evm.signer);
    const { verify, readEvmSideForStarknet } = useLZVerify();
    const cairo = useCairoOFT(stark.account);
    const cairoEndpoint = useCairoEndpoint(stark.account);
    // Chain selection
    const [homeChain, setHomeChain] = useState(null);
    const [remoteChain, setRemoteChain] = useState(null);
    const defaultEvm0 = evmChains[0] ?? { eid: 0, chainId: 0, name: '', chainKey: '', endpoint: '', rpc: '', isTestnet: true };
    const defaultEvm1 = evmChains[1] ?? defaultEvm0;
    const home = homeChain ?? toAnyEvm(defaultEvm0);
    const remote = remoteChain ?? toAnyEvm(defaultEvm1);
    // Wiring mode
    const [mode, setMode] = useState('bridge-oft');
    // Contract addresses
    const [homeAddr, setHomeAddr] = useState(CONTRACTS.adapter);
    const [remoteAddr, setRemoteAddr] = useState(CONTRACTS.peer);
    // Tab
    const [tab, setTab] = useState('verify');
    // EVM-EVM state
    const [tokenInfo, setTokenInfo] = useState(null);
    const [tokenInfoError, setTokenInfoError] = useState(null);
    const [verifying, setVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState(null);
    const [fetching, setFetching] = useState(false);
    const [starkFetchTick, setStarkFetchTick] = useState(0);
    const bothEvm = isEvm(home) && isEvm(remote);
    const hasStarknet = isStarknet(home) || isStarknet(remote);
    const evmHome = isEvm(home) ? home : null;
    const evmRemote = isEvm(remote) ? remote : null;
    // Peer map sidebar
    const [peers, setPeers] = useState(null);
    const [peersScanning, setPeersScanning] = useState(false);
    const [peersError, setPeersError] = useState(null);
    const starkHome = isStarknet(home) ? home : null;
    const canScanPeers = !!homeAddr && homeAddr !== '0x' && (!!evmHome || !!starkHome);
    async function handleScanPeers() {
        if (!canScanPeers)
            return;
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
            }
            else if (starkHome) {
                // Starknet home: call get_peer(eid) on the Cairo OFT for all EVM chains
                const evmEntries = evmChains
                    .map((c) => ({ eid: c.eid, name: c.name }));
                const result = await cairo.readAllPeers(homeAddr, evmEntries, starkHome.rpc);
                setPeers(result);
            }
        }
        catch (e) {
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
    function handleNetworkToggle(testnet) {
        setIsTestnet(testnet);
        setHomeChain(null);
        setRemoteChain(null);
        clearData();
    }
    function walletProviderForHome() {
        if (!evmHome)
            return undefined;
        return evm.provider && evm.chainId === evmHome.chainId ? evm.provider : undefined;
    }
    async function handleFetch() {
        setFetching(true);
        clearData();
        if (bothEvm && evmHome && evmRemote) {
            // Full EVM↔EVM fetch: token info + verify
            const wp = walletProviderForHome();
            const [tokenResult, verifyRes] = await Promise.allSettled([
                wiring.readTokenInfo(homeAddr, remoteAddr, evmHome.rpc, evmRemote.rpc, wp),
                verify({ adapterAddr: homeAddr, peerAddr: remoteAddr, homeChain: evmHome, remoteChain: evmRemote, walletProvider: wp }),
            ]);
            if (tokenResult.status === 'fulfilled')
                setTokenInfo(tokenResult.value);
            else
                setTokenInfoError('Could not read token names: ' + (tokenResult.reason instanceof Error ? tokenResult.reason.message : String(tokenResult.reason)));
            if (verifyRes.status === 'fulfilled')
                setVerifyResult(verifyRes.value);
        }
        else if (hasStarknet) {
            // Starknet combination: trigger peer checks in StarknetVerifyPanel
            setTab('verify');
            setStarkFetchTick((t) => t + 1);
        }
        setFetching(false);
    }
    async function handleVerify() {
        if (!bothEvm || !evmHome || !evmRemote)
            return;
        setVerifying(true);
        setVerifyResult(null);
        const result = await verify({ adapterAddr: homeAddr, peerAddr: remoteAddr, homeChain: evmHome, remoteChain: evmRemote, walletProvider: walletProviderForHome() });
        setVerifyResult(result);
        setVerifying(false);
    }
    // Auto-run EVM verify (debounced) when addresses or chains change
    const autoVerifyTimer = useRef();
    useEffect(() => {
        if (!bothEvm || !isAddr(homeAddr) || !isAddr(remoteAddr))
            return;
        clearTimeout(autoVerifyTimer.current);
        autoVerifyTimer.current = setTimeout(() => { void handleVerify(); }, 1500);
        return () => clearTimeout(autoVerifyTimer.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [homeAddr, remoteAddr, home.eid, remote.eid, bothEvm]);
    return (_jsxs("div", { className: "grid grid-cols-12 gap-6", children: [_jsxs("div", { className: "col-span-12 lg:col-span-8 space-y-6", children: [_jsxs("section", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6", children: [_jsxs("div", { className: "flex items-center gap-3 mb-6", children: [_jsx("div", { className: "w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center", children: _jsx("span", { className: "material-symbols-outlined text-primary text-lg", children: "route" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-headline text-base font-bold text-on-surface", children: "Pathway Configuration" }), _jsx("p", { className: "text-[11px] text-on-surface-variant", children: "Select chains and contract addresses" })] })] }), _jsxs("div", { className: "flex gap-2 items-center mb-5 flex-wrap", children: [_jsx("button", { className: `px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${isTestnet ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`, onClick: () => handleNetworkToggle(true), children: "Testnet" }), _jsx("button", { className: `px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${!isTestnet ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`, onClick: () => handleNetworkToggle(false), children: "Mainnet" }), chainsLoading && _jsx("span", { className: "text-xs text-on-surface-variant", children: "Loading chains\u2026" }), !chainsLoading && _jsxs("span", { className: "text-xs text-on-surface-variant", children: [evmChains.length, " EVM + 1 Starknet"] }), _jsxs("div", { className: "ml-auto flex gap-2 items-center", children: [_jsx("span", { className: "text-xs text-on-surface-variant", children: "Wire:" }), _jsx("button", { className: `px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${mode === 'bridge-oft' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`, onClick: () => setMode('bridge-oft'), children: "Adapter \u2194 OFT" }), _jsx("button", { className: `px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${mode === 'oft-oft' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`, onClick: () => setMode('oft-oft'), children: "OFT \u2194 OFT" })] })] }), _jsxs("div", { className: "form-grid", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: [homeLabel, " chain (home) \u2014 EID ", home.eid] }), _jsx(AnyChainSelect, { evmChains: evmChains, isTestnet: isTestnet, selected: home, onSelect: (c) => { setHomeChain(c); clearData(); setTab('verify'); } })] }), _jsxs("div", { children: [_jsxs("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: ["OFT chain (remote) \u2014 EID ", remote.eid] }), _jsx(AnyChainSelect, { evmChains: evmChains, isTestnet: isTestnet, selected: remote, onSelect: (c) => { setRemoteChain(c); clearData(); setTab('verify'); } })] })] }), _jsxs("div", { className: "form-grid mt-3", children: [_jsx(Field, { label: `${homeLabel} address (home)`, value: homeAddr, onChange: setHomeAddr }), _jsx(Field, { label: "OFT address (remote)", value: remoteAddr, onChange: setRemoteAddr })] }), _jsxs("div", { className: "flex items-center gap-3 mt-3 flex-wrap", children: [(bothEvm || hasStarknet) && (_jsx("button", { className: "btn btn-primary", onClick: handleFetch, disabled: fetching || !homeAddr || !remoteAddr, children: fetching ? 'Fetching…' : 'Fetch data' })), evmHome && evm.isConnected && evm.chainId === evmHome.chainId && (_jsxs("span", { className: "flex items-center gap-1.5 text-xs text-secondary", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-secondary" }), "EVM wallet on ", evmHome.name] })), evmHome && evm.isConnected && evm.chainId !== evmHome.chainId && (_jsxs("span", { className: "text-xs text-on-surface-variant", children: ["Using public RPC \u2014 switch wallet to ", evmHome.name, " to configure"] })), hasStarknet && stark.isConnected && (_jsxs("span", { className: "flex items-center gap-1.5 text-xs text-secondary", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-secondary" }), "Starknet wallet connected"] })), hasStarknet && !stark.isConnected && (_jsx("span", { className: "text-xs text-on-surface-variant", children: "Connect Starknet wallet to configure" }))] }), tokenInfo && (_jsxs("div", { className: "token-banner", children: [_jsx(TokenBadge, { label: `${homeLabel} locks`, name: tokenInfo.tokenName, symbol: tokenInfo.tokenSymbol }), _jsx("span", { style: { color: '#444', fontSize: 18 }, children: "\u2194" }), _jsx(TokenBadge, { label: "OFT mints", name: tokenInfo.peerName, symbol: tokenInfo.peerSymbol })] })), tokenInfoError && (_jsx("div", { className: "text-xs text-error mt-3", children: tokenInfoError }))] }), (bothEvm || hasStarknet) && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex gap-2 mb-1", children: [_jsx("button", { className: `px-4 py-2 rounded text-xs font-headline font-bold transition-colors ${tab === 'verify' ? 'bg-surface-container-high text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`, onClick: () => setTab('verify'), children: "Verify" }), _jsx("button", { className: `px-4 py-2 rounded text-xs font-headline font-bold transition-colors ${tab === 'configure' ? 'bg-surface-container-high text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`, onClick: () => setTab('configure'), children: "Configure" })] }), tab === 'verify' && bothEvm && evmHome && evmRemote && (_jsx(VerifyPanel, { homeChain: evmHome, remoteChain: evmRemote, verifying: verifying, result: verifyResult, onVerify: handleVerify, isAdapter: mode === 'bridge-oft' })), tab === 'verify' && hasStarknet && (_jsx(StarknetVerifyPanel, { home: home, remote: remote, homeAddr: homeAddr, remoteAddr: remoteAddr, cairo: cairo, cairoEndpoint: cairoEndpoint, readEvmSide: readEvmSideForStarknet, fetchTick: starkFetchTick })), tab === 'configure' && bothEvm && evmHome && evmRemote && (_jsx(EvmEvmConfigurePanel, { homeChain: evmHome, remoteChain: evmRemote, homeAddr: homeAddr, remoteAddr: remoteAddr, mode: mode, evm: evm, wiring: wiring, verifyResult: verifyResult })), tab === 'configure' && hasStarknet && (_jsx(StarknetConfigurePanel, { home: home, remote: remote, homeAddr: homeAddr, remoteAddr: remoteAddr, wiringMode: mode, stark: stark, cairo: cairo, cairoEndpoint: cairoEndpoint, wiring: wiring, evm: evm, verifyResult: verifyResult }))] }))] }), _jsx("div", { className: "col-span-12 lg:col-span-4", children: _jsx("div", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6 sticky top-6", children: _jsx(PeersSidebar, { peers: peers, scanning: peersScanning, error: peersError, canScan: canScanPeers, bridgeAddr: homeAddr, bridgeLabel: isStarknet(home) ? 'Cairo OFT' : homeLabel, chainName: home.name, isTestnet: isTestnet, onScan: handleScanPeers }) }) })] }));
}
// ── DVN icon with initials fallback ──────────────────────────────────────────
function DVNIcon({ provider, size = 22 }) {
    const initials = provider.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const [failed, setFailed] = useState(false);
    if (provider.icon && !failed) {
        return (_jsx("img", { src: provider.icon, alt: provider.name, width: size, height: size, onError: () => setFailed(true), style: { borderRadius: '50%', flexShrink: 0, objectFit: 'cover' } }));
    }
    return (_jsx("span", { style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: size, height: size, borderRadius: '50%',
            background: provider.color + '33', border: `1px solid ${provider.color}`,
            color: provider.color, fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
        }, children: initials }));
}
// ── Chain icon helpers ────────────────────────────────────────────────────────
/**
 * Return a DeFiLlama chain icon URL for a given chainKey.
 * Strips testnet suffixes and normalises to DeFiLlama naming.
 */
function chainIconUrl(chainKey) {
    const base = chainKey
        .replace(/-sepolia$/i, '')
        .replace(/-testnet$/i, '')
        .replace(/-goerli$/i, '')
        .replace(/-fuji$/i, '')
        .replace(/-mumbai$/i, '')
        .replace(/-nova$/i, '-nova') // keep arbitrum-nova as-is
        .toLowerCase();
    // Map LZ chainKeys to DeFiLlama chain slugs where they differ
    const overrides = {
        'ethereum': 'ethereum',
        'bsc': 'bsc',
        'avalanche': 'avax',
        'polygon': 'polygon',
        'fantom': 'fantom',
        'gnosis': 'xdai',
        'cronos': 'cronos',
        'celo': 'celo',
        'moonbeam': 'moonbeam',
        'moonriver': 'moonriver',
        'harmony': 'harmony',
        'kava': 'kava',
        'aurora': 'aurora',
        'telos': 'telos',
        'zksync': 'era',
        'polygon-zkevm': 'polygon%20zkevm',
    };
    return `https://icons.llamao.fi/icons/chains/rsz_${overrides[base] ?? base}.jpg`;
}
function ChainIcon({ chainKey, size = 18 }) {
    const [failed, setFailed] = useState(false);
    if (failed)
        return _jsx("span", { style: { width: size, height: size, display: 'inline-block', borderRadius: '50%', background: '#2a2a3a', flexShrink: 0 } });
    return (_jsx("img", { src: chainIconUrl(chainKey), alt: "", width: size, height: size, onError: () => setFailed(true), style: { borderRadius: '50%', flexShrink: 0, objectFit: 'cover' } }));
}
// ── Chain category helpers ────────────────────────────────────────────────────
function chainCategory(c) {
    const n = c.name.toLowerCase();
    const k = c.chainKey.toLowerCase();
    if (n.includes('arbitrum') || n.includes('optimism') || n.includes('base') ||
        n.includes('zksync') || n.includes('linea') || n.includes('scroll') ||
        n.includes('blast') || n.includes('mode') || n.includes('mantle') ||
        n.includes('taiko') || n.includes('polygon zk') || n.includes('manta') ||
        n.includes('zircuit') || n.includes('kroma') || n.includes('mint') ||
        k.includes('op-') || k.includes('arb') || k.includes('zk') || k.includes('l2'))
        return 'L2';
    return 'L1';
}
// ── Unified chain select (EVM + Starknet) ────────────────────────────────────
function AnyChainSelect({ evmChains, isTestnet, selected, onSelect }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef(null);
    const inputRef = useRef(null);
    const stark = starkChain(isTestnet);
    useEffect(() => {
        if (!open)
            return;
        function handle(e) {
            if (ref.current && !ref.current.contains(e.target))
                setOpen(false);
        }
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [open]);
    useEffect(() => {
        if (open)
            setTimeout(() => inputRef.current?.focus(), 0);
        else
            setQuery('');
    }, [open]);
    const q = query.toLowerCase();
    const filteredEvm = evmChains.filter((c) => c.name.toLowerCase().includes(q) || String(c.eid).includes(q));
    const isSelectedStark = isStarknet(selected);
    const selectedChainKey = isSelectedStark ? '' : selected.chainKey;
    const displayName = `${selected.name} — EID ${selected.eid}`;
    return (_jsxs("div", { ref: ref, style: { position: 'relative' }, children: [_jsxs("button", { className: "input", style: { textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
                    ...(isSelectedStark ? { borderColor: '#2a2a5a', color: '#919bff' } : {}) }, onClick: () => setOpen((v) => !v), type: "button", children: [_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [isSelectedStark
                                ? _jsx("span", { style: { width: 18, height: 18, borderRadius: '50%', background: '#919bff22', border: '1px solid #919bff55', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#919bff', fontWeight: 700 }, children: "SN" })
                                : _jsx(ChainIcon, { chainKey: selectedChainKey, size: 18 }), displayName] }), _jsx("span", { style: { color: '#555', fontSize: 11, marginLeft: 8 }, children: open ? '▲' : '▼' })] }), open && (_jsxs("div", { className: "chain-dropdown", children: [_jsxs("div", { className: `chain-option${isSelectedStark ? ' chain-option-active' : ''}`, style: { borderBottom: '1px solid #2a2a2a', color: isSelectedStark ? '#919bff' : '#919bff88', display: 'flex', alignItems: 'center', gap: 8 }, onClick: () => { onSelect(stark); setOpen(false); }, children: [_jsx("span", { style: { width: 18, height: 18, borderRadius: '50%', background: '#919bff22', border: '1px solid #919bff55', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#919bff', fontWeight: 700 }, children: "SN" }), _jsx("span", { children: stark.name }), _jsxs("span", { style: { fontSize: 11, marginLeft: 'auto' }, children: ["EID ", stark.eid] })] }), _jsx("div", { style: { padding: '6px 8px', borderBottom: '1px solid #2a2a2a' }, children: _jsx("input", { ref: inputRef, className: "input", placeholder: "Search EVM chain by name or EID\u2026", value: query, onChange: (e) => setQuery(e.target.value), style: { padding: '5px 8px' } }) }), _jsxs("div", { style: { overflowY: 'auto', maxHeight: 260 }, children: [filteredEvm.length === 0 && (_jsx("div", { style: { padding: '10px 12px', color: '#555', fontSize: 13 }, children: "No chains match" })), ['L1', 'L2'].map((cat) => {
                                const group = filteredEvm.filter((c) => chainCategory(c) === cat);
                                if (group.length === 0)
                                    return null;
                                return (_jsxs("div", { children: [_jsx("div", { style: { padding: '5px 12px 2px', fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#444' }, children: cat }), group.map((c) => (_jsxs("div", { className: `chain-option${!isSelectedStark && selected.eid === c.eid ? ' chain-option-active' : ''}`, style: { display: 'flex', alignItems: 'center', gap: 8 }, onClick: () => { onSelect(toAnyEvm(c)); setOpen(false); }, children: [_jsx(ChainIcon, { chainKey: c.chainKey, size: 18 }), _jsx("span", { children: c.name }), _jsxs("span", { style: { color: '#555', fontSize: 11, marginLeft: 'auto' }, children: ["EID ", c.eid] })] }, c.eid)))] }, cat));
                            })] })] }))] }));
}
function CheckRow({ label, passed, detail, severity = 'critical' }) {
    const cls = passed ? 'check-pass' : severity === 'warning' ? 'check-warn' : 'check-critical';
    return (_jsxs("div", { className: `check-row ${cls}`, children: [_jsx("span", { className: "check-icon", children: passed ? '✓' : '✗' }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "font-semibold", children: label }), detail && _jsx("div", { className: "text-xs opacity-80 break-all", children: detail })] })] }));
}
function StarknetVerifyPanel({ home, remote, homeAddr, remoteAddr, cairo, cairoEndpoint, readEvmSide, fetchTick }) {
    const starkChainData = (isStarknet(home) ? home : remote);
    const evmChainData = (isStarknet(home) ? remote : home);
    const cairoAddr = isStarknet(home) ? homeAddr : remoteAddr;
    const evmAddr = isStarknet(home) ? remoteAddr : homeAddr;
    const [checking, setChecking] = useState(false);
    const [evmState, setEvmState] = useState(null);
    const [starkState, setStarkState] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (fetchTick && fetchTick > 0)
            runChecks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchTick]);
    // Auto-run checks (debounced) when addresses or chain EIDs change
    const autoCheckTimer = useRef();
    useEffect(() => {
        if (!isAddr(cairoAddr) || !isAddr(evmAddr))
            return;
        clearTimeout(autoCheckTimer.current);
        autoCheckTimer.current = setTimeout(() => { void runChecks(); }, 1500);
        return () => clearTimeout(autoCheckTimer.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cairoAddr, evmAddr, home.eid, remote.eid]);
    async function runChecks() {
        if (!isAddr(cairoAddr) || !isAddr(evmAddr))
            return;
        setChecking(true);
        setError(null);
        setEvmState(null);
        setStarkState(null);
        try {
            const [evmResult, starkResult] = await Promise.allSettled([
                readEvmSide(evmAddr, starkChainData.eid, evmChainData),
                (async () => {
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
            if (evmResult.status === 'fulfilled')
                setEvmState(evmResult.value);
            else
                setError(`EVM read error: ${evmResult.reason}`);
            if (starkResult.status === 'fulfilled')
                setStarkState(starkResult.value);
            else
                setError((e) => (e ? e + ' | ' : '') + `Starknet read error: ${starkResult.reason}`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        setChecking(false);
    }
    const expectedEvmPeer = isAddr(cairoAddr) ? addrToBytes32(cairoAddr) : null;
    const expectedCairoPeer = isAddr(evmAddr) ? addrToBytes32(evmAddr) : null;
    const ZERO64 = '0x' + '0'.repeat(64);
    const done = !checking && (evmState !== null || starkState !== null);
    return (_jsxs("section", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-headline text-base font-bold text-on-surface m-0", children: "Pathway verification" }), _jsxs("span", { className: "text-xs text-on-surface-variant", children: [home.name, " (EID ", home.eid, ") \u2194 ", remote.name, " (EID ", remote.eid, ")"] })] }), _jsx("button", { className: "btn btn-primary", onClick: runChecks, disabled: checking || !isAddr(cairoAddr) || !isAddr(evmAddr), children: checking ? 'Checking…' : 'Run checks' })] }), !done && !checking && (_jsxs("p", { className: "text-xs text-on-surface-variant", children: ["Enter both contract addresses above, then press ", _jsx("strong", { children: "Run checks" }), " to read on-chain state from both endpoints. No wallet required."] })), error && _jsx("div", { className: "check-row check-critical", children: _jsx("span", { children: error }) }), evmState && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant mt-3 mb-1", children: [evmChainData.name, " (send \u2192 Starknet)"] }), _jsx(CheckRow, { label: "Send library set", passed: !!evmState.sendLib && evmState.sendLib !== '0x0000000000000000000000000000000000000000', detail: evmState.sendLib ?? 'Not set' }), _jsx(CheckRow, { label: "Executor configured", passed: !!evmState.executor && evmState.executor.executor !== '0x0000000000000000000000000000000000000000', detail: evmState.executor ? `${evmState.executor.executor} (max ${evmState.executor.maxMessageSize} bytes)` : 'Not configured' }), _jsx(CheckRow, { label: "DVNs configured (send)", passed: !!evmState.dvnSend && evmState.dvnSend.requiredDVNCount > 0, detail: evmState.dvnSend?.requiredDVNCount ? `${evmState.dvnSend.requiredDVNCount} required: ${evmState.dvnSend.requiredDVNs.join(', ')}` : 'No DVNs set' }), _jsx(CheckRow, { label: "Enforced options set", passed: !!evmState.enforcedOptions && evmState.enforcedOptions !== '0x', detail: evmState.enforcedOptions ?? 'Not set' }), _jsx(CheckRow, { label: "Delegate set", passed: !!evmState.delegate && evmState.delegate !== '0x0000000000000000000000000000000000000000', detail: evmState.delegate ?? 'Not set', severity: "warning" }), _jsx(CheckRow, { label: "Peer set (EVM \u2192 Starknet)", passed: !!evmState.peer && evmState.peer !== ZERO64 && expectedEvmPeer !== null && evmState.peer.toLowerCase() === expectedEvmPeer.toLowerCase(), detail: evmState.peer && evmState.peer !== ZERO64 ? evmState.peer : 'Not set' }), _jsxs("div", { className: "text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant mt-3 mb-1", children: [evmChainData.name, " (receive \u2190 Starknet)"] }), _jsx(CheckRow, { label: "Receive library set", passed: !!evmState.recvLib && evmState.recvLib !== '0x0000000000000000000000000000000000000000' && !evmState.recvLibIsDefault, detail: evmState.recvLib ? `${evmState.recvLib}${evmState.recvLibIsDefault ? ' (default — set explicitly)' : ''}` : 'Not set', severity: evmState.recvLibIsDefault ? 'warning' : 'critical' }), _jsx(CheckRow, { label: "DVNs configured (receive)", passed: !!evmState.dvnRecv && evmState.dvnRecv.requiredDVNCount > 0, detail: evmState.dvnRecv?.requiredDVNCount ? `${evmState.dvnRecv.requiredDVNCount} required: ${evmState.dvnRecv.requiredDVNs.join(', ')}` : 'No DVNs set' })] })), starkState && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-[10px] font-mono font-bold uppercase tracking-widest text-tertiary mt-3 mb-1", children: [starkChainData.name, " (send \u2192 EVM)"] }), _jsx(CheckRow, { label: "Send library set", passed: !!starkState.sendLib, detail: starkState.sendLib ?? 'Not set' }), _jsx(CheckRow, { label: "Enforced options set", passed: starkState.enforcedOptions, detail: starkState.enforcedOptions ? 'Set' : 'Not set' }), _jsx(CheckRow, { label: "Delegate set", passed: !!starkState.delegate, detail: starkState.delegate ?? 'Not set', severity: "warning" }), _jsx(CheckRow, { label: "Peer set (Starknet \u2192 EVM)", passed: !!starkState.peer && starkState.peer !== ZERO64 && expectedCairoPeer !== null && starkState.peer.toLowerCase() === expectedCairoPeer.toLowerCase(), detail: starkState.peer && starkState.peer !== ZERO64 ? starkState.peer : 'Not set' }), _jsxs("div", { className: "text-[10px] font-mono font-bold uppercase tracking-widest text-tertiary mt-3 mb-1", children: [starkChainData.name, " (receive \u2190 EVM)"] }), _jsx(CheckRow, { label: "Receive library set", passed: !!starkState.recvLib && !starkState.recvLibIsDefault, detail: starkState.recvLib ? `${starkState.recvLib}${starkState.recvLibIsDefault ? ' (default)' : ''}` : 'Not set', severity: starkState.recvLibIsDefault ? 'warning' : 'critical' })] }))] }));
}
// ── Shared column header ──────────────────────────────────────────────────────
function ChainColumnHeader({ label, chainName, eid, connected }) {
    return (_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx("span", { className: "text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant", children: label }), _jsxs("span", { className: "text-xs text-on-surface-variant", children: [chainName, " \u2014 EID ", eid] }), connected
                ? _jsxs("span", { className: "text-xs text-secondary ml-auto flex items-center gap-1", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-secondary inline-block" }), "connected"] })
                : _jsx("span", { className: "text-xs text-outline-variant ml-auto", children: "wallet needed" })] }));
}
function PeerConnectSection({ left, right, evm }) {
    const [confirmed, setConfirmed] = useState(false);
    const [leftTx, setLeftTx] = useState({ status: 'idle' });
    const [rightTx, setRightTx] = useState({ status: 'idle' });
    return (_jsxs("div", { className: `bg-surface-container-low rounded-xl border p-6 mt-4 ${confirmed ? 'border-secondary/20' : 'border-outline-variant/10'}`, children: [_jsxs("div", { className: "mb-4", children: [_jsx("div", { className: "font-headline text-sm font-bold text-on-surface mb-2", children: "Connect Peers" }), _jsx("div", { className: "step-warn-banner", children: "\u26A0 Setting peers opens the messaging channel. Tokens can flow immediately. Complete all configuration steps on both sides first." })] }), _jsxs("label", { className: "flex items-center gap-2 text-xs text-on-surface cursor-pointer mb-4", children: [_jsx("input", { type: "checkbox", checked: confirmed, onChange: (e) => setConfirmed(e.target.checked) }), "Both sides are fully configured and the addresses above are correct."] }), _jsxs("div", { className: "flex gap-4", children: [_jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "label", children: left.peerLabel }), _jsx("div", { className: "mono-block mb-2", children: left.peerBytes32 || '(enter address above)' }), left.chainId > 0 && left.connectedChainId !== left.chainId && (_jsxs("button", { className: "btn text-[11px] py-1 px-2.5 mb-1.5", onClick: left.onSwitch, children: ["Switch to ", left.chainName] })), _jsx("div", { children: _jsxs("button", { className: "btn btn-primary", disabled: !confirmed || (left.chainId > 0 && (!left.isConnected || left.connectedChainId !== left.chainId)), onClick: async () => { setLeftTx({ status: 'pending' }); setLeftTx(await left.onSet()); }, children: ["Set Peer on ", left.chainName] }) }), _jsx("div", { className: "mt-1.5", children: _jsx(TxStatus, { state: leftTx }) })] }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "label", children: right.peerLabel }), _jsx("div", { className: "mono-block mb-2", children: right.peerBytes32 || '(enter address above)' }), right.chainId > 0 && right.connectedChainId !== right.chainId && (_jsxs("button", { className: "btn text-[11px] py-1 px-2.5 mb-1.5", onClick: right.onSwitch, children: ["Switch to ", right.chainName] })), _jsx("div", { children: _jsxs("button", { className: "btn btn-primary", disabled: !confirmed || (right.chainId > 0 && (!right.isConnected || right.connectedChainId !== right.chainId)), onClick: async () => { setRightTx({ status: 'pending' }); setRightTx(await right.onSet()); }, children: ["Set Peer on ", right.chainName] }) }), _jsx("div", { className: "mt-1.5", children: _jsx(TxStatus, { state: rightTx }) })] })] })] }));
}
// ── EVM-EVM configure panel (side-by-side) ────────────────────────────────────
function EvmEvmConfigurePanel({ homeChain, remoteChain, homeAddr, remoteAddr, mode, evm, wiring, verifyResult }) {
    const isAdapter = mode === 'bridge-oft';
    const homeConnected = evm.isConnected && evm.chainId === homeChain.chainId;
    const remoteConnected = evm.isConnected && evm.chainId === remoteChain.chainId;
    const [evmSide, setEvmSide] = useState('home');
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex gap-2 mb-4", children: [_jsx("button", { className: `px-4 py-2 rounded text-xs font-headline font-bold transition-colors ${evmSide === 'home' ? 'bg-surface-container-high text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`, onClick: () => setEvmSide('home'), children: _jsxs("span", { className: "flex items-center gap-1.5", children: [homeConnected && _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-secondary inline-block" }), homeChain.name] }) }), _jsx("button", { className: `px-4 py-2 rounded text-xs font-headline font-bold transition-colors ${evmSide === 'remote' ? 'bg-surface-container-high text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`, onClick: () => setEvmSide('remote'), children: _jsxs("span", { className: "flex items-center gap-1.5", children: [remoteConnected && _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-secondary inline-block" }), remoteChain.name] }) })] }), evmSide === 'home' && (_jsxs(_Fragment, { children: [_jsx(ChainColumnHeader, { label: isAdapter ? 'Adapter' : 'OFT', chainName: homeChain.name, eid: homeChain.eid, connected: homeConnected }), _jsx(GuidedConfigure, { homeChain: homeChain, remoteChain: remoteChain, adapterAddr: homeAddr, peerAddr: remoteAddr, connectedChainId: evm.chainId, isConnected: evm.isConnected, signer: evm.signer, onSwitchNetwork: evm.switchNetwork, wiring: wiring, verifyResult: verifyResult, isAdapter: isAdapter, isRemoteEvm: false, hidePeerStep: true })] })), evmSide === 'remote' && (_jsxs(_Fragment, { children: [_jsx(ChainColumnHeader, { label: "OFT", chainName: remoteChain.name, eid: remoteChain.eid, connected: remoteConnected }), _jsx(GuidedConfigure, { homeChain: remoteChain, remoteChain: homeChain, adapterAddr: remoteAddr, peerAddr: homeAddr, connectedChainId: evm.chainId, isConnected: evm.isConnected, signer: evm.signer, onSwitchNetwork: evm.switchNetwork, wiring: wiring, verifyResult: null, isAdapter: false, isRemoteEvm: false, hidePeerStep: true })] })), _jsx(PeerConnectSection, { left: {
                    chainName: homeChain.name,
                    chainId: homeChain.chainId,
                    peerLabel: `${homeChain.name} → ${remoteChain.name}`,
                    peerBytes32: isAddr(remoteAddr) ? addrToBytes32(remoteAddr) : '',
                    connectedChainId: evm.chainId,
                    isConnected: evm.isConnected,
                    onSwitch: () => evm.switchNetwork(homeChain.chainId),
                    onSet: () => wiring.setEvmPeer(homeAddr, remoteChain.eid, remoteAddr),
                }, right: {
                    chainName: remoteChain.name,
                    chainId: remoteChain.chainId,
                    peerLabel: `${remoteChain.name} → ${homeChain.name}`,
                    peerBytes32: isAddr(homeAddr) ? addrToBytes32(homeAddr) : '',
                    connectedChainId: evm.chainId,
                    isConnected: evm.isConnected,
                    onSwitch: () => evm.switchNetwork(remoteChain.chainId),
                    onSet: () => wiring.setEvmPeer(remoteAddr, homeChain.eid, homeAddr),
                } })] }));
}
// ── Starknet configure panel (side-by-side EVM | Starknet) ────────────────────
function StarknetConfigurePanel({ home, remote, homeAddr, remoteAddr, wiringMode, stark, cairo, cairoEndpoint, wiring, evm, verifyResult }) {
    const starkChainData = (isStarknet(home) ? home : remote);
    const evmChainData = (isStarknet(home) ? remote : home);
    const cairoAddr = isStarknet(home) ? homeAddr : remoteAddr;
    const evmAddr = isStarknet(home) ? remoteAddr : homeAddr;
    const evmIsHome = isEvm(home);
    const isAdapter = wiringMode === 'bridge-oft';
    const starkAsRemote = {
        eid: starkChainData.eid, chainId: -1, chainKey: starkChainData.chainKey,
        name: starkChainData.name, endpoint: starkChainData.endpoint,
        rpc: starkChainData.rpc, isTestnet: starkChainData.isTestnet,
        sendLib: starkChainData.sendLib, receiveLib: starkChainData.receiveLib,
    };
    const evmConnected = evm.isConnected && evm.chainId === evmChainData.chainId;
    const starkConnected = stark.isConnected;
    const starkHint = !starkConnected ? _jsx("span", { className: "text-xs text-on-surface-variant", children: "Connect Starknet wallet first" }) : null;
    // Starknet accordion — correct LZ order: Delegate→Libraries→DVNs→Executor→EnforcedOptions→Peer(last)
    const [openStarkStep, setOpenStarkStep] = useState(1);
    const toggleStark = (n) => setOpenStarkStep((p) => (p === n ? null : n));
    // Tx states
    const [delegateTx, setDelegateTx] = useState({ status: 'idle' });
    const [libTx, setLibTx] = useState({ status: 'idle' });
    const [sendConfigTx, setSendConfigTx] = useState({ status: 'idle' });
    const [recvConfigTx, setRecvConfigTx] = useState({ status: 'idle' });
    const [enforcedOptsTx, setEnforcedOptsTx] = useState({ status: 'idle' });
    // Field state
    const [cairoDelegate, setCairoDelegate] = useState('');
    const [cairoLib, setCairoLib] = useState(starkChainData.sendLib ?? '');
    const [cairoGracePeriod, setCairoGracePeriod] = useState('0');
    const [cairoConfirm, setCairoConfirm] = useState(starkChainData.isTestnet ? '1' : '15');
    const [cairoExecutor, setCairoExecutor] = useState(starkChainData.executor ?? '');
    const [cairoMaxMsgSize, setCairoMaxMsgSize] = useState('10000');
    const [cairoGas, setCairoGas] = useState('80000');
    // DVNs — single pair for send and receive (same DVNs on both directions is standard)
    const [sendDvns, setSendDvns] = useState(new Map());
    const [recvDvns, setRecvDvns] = useState(new Map());
    const [sameRecvDvns, setSameRecvDvns] = useState(true);
    const { dvns: availableDvns, loading: dvnsLoading } = useDVNCatalog(starkChainData.chainKey);
    function toggleDvn(side, addr, provider) {
        const setter = side === 'send' ? setSendDvns : setRecvDvns;
        setter((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, provider); return next; });
    }
    // When "same DVNs" toggle is on, keep recv in sync with send
    function toggleSendDvn(addr, provider) {
        setSendDvns((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, provider); return next; });
        if (sameRecvDvns) {
            setRecvDvns((prev) => { const next = new Map(prev); next.has(addr) ? next.delete(addr) : next.set(addr, provider); return next; });
        }
    }
    // EVM column is always left, Starknet always right (symmetric regardless of home/remote)
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex gap-4 items-start", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsx(ChainColumnHeader, { label: "EVM", chainName: evmChainData.name, eid: evmChainData.eid, connected: evmConnected }), _jsx(GuidedConfigure, { homeChain: evmChainData, remoteChain: starkAsRemote, adapterAddr: evmIsHome ? homeAddr : remoteAddr, peerAddr: evmIsHome ? remoteAddr : homeAddr, connectedChainId: evm.chainId, isConnected: evm.isConnected, signer: evm.signer, onSwitchNetwork: evm.switchNetwork, wiring: wiring, verifyResult: verifyResult, isAdapter: isAdapter && evmIsHome, isRemoteEvm: false, hidePeerStep: true })] }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx(ChainColumnHeader, { label: "Starknet", chainName: starkChainData.name, eid: starkChainData.eid, connected: starkConnected }), _jsxs(CairoStepCard, { n: 1, title: "Delegate", subtitle: "Set delegate before configuring the endpoint. Required first step.", open: openStarkStep === 1, onToggle: () => toggleStark(1), children: [_jsx("p", { className: "step-hint", children: "The delegate authorises an external account to configure the endpoint on behalf of this OFT. Must be set before steps 2\u20134." }), _jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "label", children: "Delegate address" }), _jsx("input", { className: "input", value: cairoDelegate, onChange: (e) => setCairoDelegate(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { className: "flex gap-2 items-center flex-wrap", children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoDelegate, onClick: async () => { setDelegateTx({ status: 'pending' }); setDelegateTx(await cairoEndpoint.setDelegate(cairoAddr, cairoDelegate, starkChainData.rpc)); }, children: "Set Delegate" }), starkHint] }), _jsx(TxStatus, { state: delegateTx })] }), _jsxs(CairoStepCard, { n: 2, title: "Message Libraries", subtitle: "Set send & receive library. On Starknet both use the same address.", open: openStarkStep === 2, onToggle: () => toggleStark(2), children: [_jsx("p", { className: "step-hint", children: "SendUln302 and ReceiveUln302 are the same contract on Starknet \u2014 one address sets both directions." }), starkChainData.sendLib && (_jsxs("div", { className: "text-xs text-on-surface-variant mb-2", children: ["Known lib: ", _jsx("span", { className: "font-mono text-[11px] text-on-surface", children: starkChainData.sendLib })] })), _jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "label", children: "Library address (ULN302)" }), _jsx("input", { className: "input", value: cairoLib, onChange: (e) => setCairoLib(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "label", children: "Grace period (blocks, 0 = immediate)" }), _jsx("input", { className: "input w-[120px]", value: cairoGracePeriod, onChange: (e) => setCairoGracePeriod(e.target.value) })] }), _jsxs("div", { className: "flex gap-2 items-center flex-wrap", children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoLib, onClick: async () => { setLibTx({ status: 'pending' }); setLibTx(await cairoEndpoint.setLibraries(starkChainData.endpoint, cairoAddr, evmChainData.eid, cairoLib, Number(cairoGracePeriod), starkChainData.rpc)); }, children: "Set Send & Receive Library" }), starkHint] }), _jsx(TxStatus, { state: libTx })] }), _jsxs(CairoStepCard, { n: 3, title: "Send Config", subtitle: "Set DVN security stack + executor atomically on the Starknet Endpoint (send direction).", open: openStarkStep === 3, onToggle: () => toggleStark(3), children: [_jsx("p", { className: "step-hint", children: "DVN and executor are set together in one transaction (LZ recommended). DVN addresses are sorted ascending automatically." }), _jsxs("div", { className: "mb-2 text-xs text-on-surface-variant", children: ["Using library: ", _jsx("span", { className: "font-mono text-on-surface", children: cairoLib || _jsx("span", { className: "text-outline-variant", children: "not set \u2014 configure in step 2" }) })] }), _jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "label", children: "Required DVNs (send \u2014 Starknet \u2192 EVM)" }), _jsx(CairoDVNPicker, { dvns: availableDvns, loading: dvnsLoading, selected: sendDvns, onToggle: (a, p) => toggleSendDvn(a, p) }), sendDvns.size === 0 && _jsx("div", { className: "text-[11px] text-on-surface-variant mt-1", children: "Select at least one DVN" })] }), _jsxs("div", { className: "form-grid mb-2", children: [_jsxs("div", { children: [_jsx("div", { className: "label", children: "Block confirmations" }), _jsx("input", { className: "input", value: cairoConfirm, onChange: (e) => setCairoConfirm(e.target.value) })] }), _jsxs("div", { children: [_jsx("div", { className: "label", children: "Max message size (bytes)" }), _jsx("input", { className: "input", value: cairoMaxMsgSize, onChange: (e) => setCairoMaxMsgSize(e.target.value) })] })] }), _jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "label", children: "Executor address" }), _jsx("input", { className: "input", value: cairoExecutor, onChange: (e) => setCairoExecutor(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { className: "flex gap-2 items-center flex-wrap", children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoLib || sendDvns.size === 0 || !cairoExecutor, onClick: async () => {
                                                    setSendConfigTx({ status: 'pending' });
                                                    setSendConfigTx(await cairoEndpoint.setSendConfigsAtomic(starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid, { confirmations: Number(cairoConfirm), requiredDvns: sortDvns([...sendDvns.keys()]) }, { maxMessageSize: Number(cairoMaxMsgSize), executor: cairoExecutor }, starkChainData.rpc));
                                                }, children: "Set Send Config (DVN + Executor)" }), starkHint] }), _jsx(TxStatus, { state: sendConfigTx })] }), _jsxs(CairoStepCard, { n: 4, title: "Receive Config", subtitle: "Set DVN security stack on the Starknet Endpoint (receive direction).", open: openStarkStep === 4, onToggle: () => toggleStark(4), children: [_jsx("p", { className: "step-hint", children: "Receive side only needs DVN config \u2014 no executor required. By default uses the same DVNs as send." }), _jsxs("div", { className: "mb-2 text-xs text-on-surface-variant", children: ["Using library: ", _jsx("span", { className: "font-mono text-on-surface", children: cairoLib || _jsx("span", { className: "text-outline-variant", children: "not set \u2014 configure in step 2" }) })] }), _jsxs("label", { className: "flex items-center gap-2 text-xs text-on-surface cursor-pointer mb-2", children: [_jsx("input", { type: "checkbox", checked: sameRecvDvns, onChange: (e) => {
                                                    setSameRecvDvns(e.target.checked);
                                                    if (e.target.checked)
                                                        setRecvDvns(new Map(sendDvns));
                                                } }), "Use same DVNs as send direction (recommended)"] }), !sameRecvDvns && (_jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "label", children: "Required DVNs (receive \u2014 EVM \u2192 Starknet)" }), _jsx(CairoDVNPicker, { dvns: availableDvns, loading: dvnsLoading, selected: recvDvns, onToggle: (a, p) => toggleDvn('recv', a, p) }), recvDvns.size === 0 && _jsx("div", { className: "text-[11px] text-on-surface-variant mt-1", children: "Select at least one DVN" })] })), _jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "label", children: "Block confirmations" }), _jsx("input", { className: "input w-[100px]", value: cairoConfirm, onChange: (e) => setCairoConfirm(e.target.value) })] }), _jsxs("div", { className: "flex gap-2 items-center flex-wrap", children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoLib || (sameRecvDvns ? sendDvns.size === 0 : recvDvns.size === 0), onClick: async () => {
                                                    setRecvConfigTx({ status: 'pending' });
                                                    const dvns = sameRecvDvns ? sendDvns : recvDvns;
                                                    setRecvConfigTx(await cairoEndpoint.setUlnReceiveConfig(starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid, { confirmations: Number(cairoConfirm), requiredDvns: sortDvns([...dvns.keys()]) }, starkChainData.rpc));
                                                }, children: "Set Receive Config" }), starkHint] }), _jsx(TxStatus, { state: recvConfigTx })] }), _jsxs(CairoStepCard, { n: 5, title: "Enforced Options", subtitle: "Set minimum gas for lzReceive on the Starknet OFT.", open: openStarkStep === 5, onToggle: () => toggleStark(5), children: [_jsx("p", { className: "step-hint", children: "Must be set after DVN and executor config, but before opening peers." }), _jsxs("div", { className: "flex gap-2 items-end flex-wrap mb-2", children: [_jsxs("div", { children: [_jsx("div", { className: "label", children: "Gas limit for lzReceive" }), _jsx("input", { className: "input w-[140px]", value: cairoGas, onChange: (e) => setCairoGas(e.target.value) })] }), _jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr, onClick: async () => { setEnforcedOptsTx({ status: 'pending' }); setEnforcedOptsTx(await cairoEndpoint.setEnforcedOptions(cairoAddr, evmChainData.eid, BigInt(cairoGas), starkChainData.rpc)); }, children: "Set on Starknet OFT" }), starkHint] }), _jsx(TxStatus, { state: enforcedOptsTx })] })] })] }), _jsx(PeerConnectSection, { left: {
                    chainName: evmChainData.name,
                    chainId: evmChainData.chainId,
                    peerLabel: `${evmChainData.name} → Starknet`,
                    peerBytes32: isAddr(cairoAddr) ? addrToBytes32(cairoAddr) : '',
                    connectedChainId: evm.chainId,
                    isConnected: evm.isConnected,
                    onSwitch: () => evm.switchNetwork(evmChainData.chainId),
                    onSet: () => wiring.setEvmPeer(evmIsHome ? homeAddr : remoteAddr, starkChainData.eid, cairoAddr),
                }, right: {
                    chainName: starkChainData.name,
                    chainId: -1, // no chainId gate for Starknet (wallet is already connected)
                    peerLabel: `Starknet → ${evmChainData.name}`,
                    peerBytes32: isAddr(evmAddr) ? addrToBytes32(evmAddr) : '',
                    connectedChainId: null,
                    isConnected: starkConnected,
                    onSwitch: () => { },
                    onSet: () => cairo.setPeer(cairoAddr, evmChainData.eid, evmAddr),
                } })] }));
}
// ── Cairo DVN picker (inline, no external search) ─────────────────────────────
function CairoDVNPicker({ dvns, loading, selected, onToggle }) {
    if (loading)
        return _jsx("div", { className: "text-xs text-on-surface-variant", children: "Loading DVNs\u2026" });
    if (dvns.length === 0)
        return (_jsx("div", { className: "text-xs text-on-surface-variant", children: "No DVNs found for this chain. Enter addresses manually if needed." }));
    return (_jsx("div", { className: "flex flex-col gap-1", children: dvns.map((p) => {
            const addr = p.address.toLowerCase();
            const checked = selected.has(addr);
            return (_jsxs("label", { style: {
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    padding: '6px 8px', borderRadius: 6,
                    background: checked ? p.color + '15' : 'transparent',
                    border: `1px solid ${checked ? p.color + '66' : 'rgba(64,72,93,0.3)'}`,
                }, children: [_jsx("input", { type: "checkbox", checked: checked, onChange: () => onToggle(addr, p) }), _jsx(DVNIcon, { provider: p, size: 22 }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-[13px] font-semibold text-on-surface", children: p.name }), _jsxs("div", { className: "text-[10px] text-on-surface-variant font-mono", children: [p.address.slice(0, 12), "\u2026", p.address.slice(-6)] })] })] }, p.address));
        }) }));
}
function CairoStepCard({ n, title, subtitle, open, onToggle, children }) {
    return (_jsxs("div", { className: `bg-surface-container rounded-lg border mt-1.5 overflow-hidden ${open ? 'border-outline-variant/20' : 'border-outline-variant/10'}`, children: [_jsxs("button", { className: "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container-high transition-colors", onClick: onToggle, children: [_jsx("span", { className: "w-6 h-6 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-bold flex items-center justify-center flex-shrink-0", children: n }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "font-headline text-sm font-semibold text-on-surface", children: title }), _jsx("div", { className: "text-[11px] text-on-surface-variant", children: subtitle })] }), _jsx("span", { className: "text-on-surface-variant text-xs ml-2", children: open ? '▲' : '▼' })] }), open && _jsx("div", { className: "px-4 pb-4 pt-2 border-t border-outline-variant/10", children: children })] }));
}
// ── Peers sidebar ─────────────────────────────────────────────────────────────
function PeersSidebar({ peers, scanning, error, canScan, bridgeAddr, bridgeLabel = 'Adapter', chainName, isTestnet, onScan }) {
    const connected = peers?.filter((p) => p.peer !== null) ?? [];
    const unset = peers?.filter((p) => p.peer === null) ?? [];
    const [showAll, setShowAll] = useState(false);
    return (_jsxs("div", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-4", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsxs("div", { children: [_jsx("div", { className: "font-headline text-sm font-bold text-on-surface", children: "Connected Peers" }), _jsx("div", { className: "text-[11px] text-on-surface-variant mt-0.5", children: chainName || 'select home chain' })] }), _jsx("button", { className: "btn btn-primary text-[12px] py-1 px-2.5", disabled: !canScan || scanning, onClick: onScan, title: !canScan ? 'Enter a contract address and select home chain first' : '', children: scanning ? 'Scanning…' : 'Scan' })] }), !peers && !scanning && !error && (_jsxs("div", { className: "text-xs text-on-surface-variant text-center py-5", children: ["Enter a contract address above and press ", _jsx("strong", { children: "Scan" }), " to discover all connected chains."] })), scanning && (_jsxs("div", { className: "text-xs text-on-surface-variant text-center py-5", children: ["Querying ", isTestnet ? 'testnet' : 'mainnet', " chains\u2026"] })), error && (_jsxs("div", { className: "text-xs text-error break-all", children: ["Error: ", error] })), peers && !scanning && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex gap-2 mb-3 text-xs", children: [_jsxs("span", { className: "text-secondary font-semibold", children: [connected.length, " connected"] }), _jsxs("span", { className: "text-on-surface-variant", children: ["/ ", peers.length, " checked"] })] }), _jsxs("div", { className: "mb-3 p-2 bg-surface-container rounded-lg border border-outline-variant/10", children: [_jsx("div", { className: "text-[10px] text-on-surface-variant mb-0.5", children: bridgeLabel }), _jsx("div", { className: "font-mono text-[11px] text-on-surface break-all", children: bridgeAddr })] }), connected.length === 0 && (_jsx("div", { className: "text-xs text-on-surface-variant text-center py-2", children: "No peers set" })), connected.map((p) => (_jsx(PeerRow, { entry: p }, p.eid))), unset.length > 0 && (_jsxs(_Fragment, { children: [_jsx("button", { className: "btn btn-ghost text-[11px] w-full mt-2 justify-center", onClick: () => setShowAll((v) => !v), children: showAll ? '▲ Hide' : `▼ Show ${unset.length} unset chain${unset.length > 1 ? 's' : ''}` }), showAll && unset.map((p) => (_jsx(PeerRow, { entry: p }, p.eid)))] }))] }))] }));
}
function PeerRow({ entry }) {
    const isSet = entry.peer !== null;
    const isStarknetEid = entry.eid === 40500 || entry.eid === 30500;
    // Decode peer address for display
    let displayPeer = entry.peer ?? '—';
    if (isSet && isStarknetEid && entry.peer) {
        // Starknet felt: bytes32 → trim leading zeros for felt
        const felt = BigInt(entry.peer);
        displayPeer = '0x' + felt.toString(16);
    }
    else if (isSet && entry.peer) {
        // EVM: last 20 bytes = address
        displayPeer = '0x' + entry.peer.slice(-40);
    }
    return (_jsxs("div", { className: `flex flex-col gap-0.5 p-2 mb-1.5 rounded-lg border ${isSet ? 'bg-secondary/5 border-secondary/20' : 'bg-surface-container border-outline-variant/10 opacity-40'}`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: `text-[13px] font-semibold flex items-center gap-1.5 ${isSet ? 'text-on-surface' : 'text-on-surface-variant'}`, children: [_jsx("span", { className: `w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSet ? 'bg-secondary' : 'bg-outline-variant'}` }), entry.name] }), _jsxs("span", { className: "text-[10px] text-on-surface-variant", children: ["EID ", entry.eid] })] }), isSet && (_jsxs("div", { className: "font-mono text-[11px] text-secondary break-all", children: [displayPeer.slice(0, 14), "\u2026", displayPeer.slice(-8)] })), entry.error && (_jsx("div", { className: "text-[10px] text-error", children: "read error" }))] }));
}
// ── Token banner ──────────────────────────────────────────────────────────────
function TokenBadge({ label, name, symbol }) {
    return (_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "label mb-0.5", children: label }), _jsx("div", { className: "font-headline font-bold text-base text-on-surface", children: symbol }), _jsx("div", { className: "text-xs text-on-surface-variant", children: name })] }));
}
// ── Verify panel ──────────────────────────────────────────────────────────────
function VerifyPanel({ homeChain, remoteChain, verifying, result, onVerify, isAdapter = true }) {
    const { resolveName: resolveHome } = useDVNCatalog(homeChain.chainKey);
    const { resolveName: resolveRemote } = useDVNCatalog(remoteChain.chainKey);
    function dvnLabel(addr, resolver) {
        const name = resolver(addr);
        return name ? `${name} (${addr.slice(0, 8)}…${addr.slice(-4)})` : addr;
    }
    function resolveDetail(detail) {
        return detail.replace(/0x[0-9a-fA-F]{40}/g, (addr) => {
            const name = resolveHome(addr) ?? resolveRemote(addr);
            return name ? `${name} (${addr.slice(0, 8)}…)` : addr;
        });
    }
    const criticalFailed = result?.checks.filter((c) => !c.passed && c.severity === 'critical') ?? [];
    const warnFailed = result?.checks.filter((c) => !c.passed && c.severity === 'warning') ?? [];
    const passed = result?.checks.filter((c) => c.passed) ?? [];
    const [showPassed, setShowPassed] = useState(false);
    return (_jsxs("section", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-headline text-base font-bold text-on-surface m-0", children: "Pathway verification" }), _jsxs("span", { className: "text-xs text-on-surface-variant", children: [homeChain.name, " (EID ", homeChain.eid, ") \u2192 ", remoteChain.name, " (EID ", remoteChain.eid, ")"] })] }), _jsx("button", { className: "btn", onClick: onVerify, disabled: verifying, children: verifying ? 'Checking…' : 'Re-run checks' })] }), !result && !verifying && (_jsxs("p", { className: "text-xs text-on-surface-variant", children: ["Checks run automatically when addresses are entered. Press ", _jsx("strong", { children: "Re-run checks" }), " to refresh."] })), result?.error && (_jsx("div", { className: "check-row check-critical", children: _jsxs("span", { children: ["RPC error: ", result.error] }) })), result && !result.error && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "verify-summary", children: [_jsx(SummaryItem, { label: "Executor", value: result.homeExecutor?.executor ?? '—' }), _jsx(SummaryItem, { label: "Max msg size", value: result.homeExecutor ? `${result.homeExecutor.maxMessageSize} bytes` : '—' }), _jsx(SummaryItem, { label: "Send lib", value: result.homeSendLib ?? '—' }), _jsx(SummaryItem, { label: "Recv lib", value: result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : '—' }), _jsx(SummaryItem, { label: "Confirmations", value: result.homeDVN ? `${result.homeDVN.confirmations} blocks` : '—' }), isAdapter && result.homeRateLimit !== undefined && (_jsx(SummaryItem, { label: "Rate limit", value: result.homeRateLimit ? `${String(result.homeRateLimit.limit)} / ${result.homeRateLimit.window}s` : 'disabled' }))] }), _jsxs("div", { className: "flex gap-3 my-3 text-xs", children: [criticalFailed.length > 0 && _jsxs("span", { className: "text-error font-semibold", children: [criticalFailed.length, " critical"] }), warnFailed.length > 0 && _jsxs("span", { className: "text-warning font-semibold", children: [warnFailed.length, " warning", warnFailed.length > 1 ? 's' : ''] }), criticalFailed.length === 0 && warnFailed.length === 0 && _jsx("span", { className: "text-secondary font-semibold", children: "All checks passed" }), _jsxs("span", { className: "text-on-surface-variant", children: [passed.length, "/", result.checks.length, " passed"] })] }), [...criticalFailed, ...warnFailed].map((c, i) => (_jsxs("div", { className: `check-row ${c.severity === 'critical' ? 'check-critical' : 'check-warn'}`, children: [_jsx("span", { className: "check-icon", children: c.severity === 'critical' ? '✗' : '!' }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "font-semibold", children: c.label }), _jsx("div", { className: "text-xs opacity-80 break-all", children: resolveDetail(c.detail) })] })] }, i))), passed.length > 0 && (_jsxs(_Fragment, { children: [_jsx("button", { className: "btn btn-ghost text-[11px] w-full mt-2 justify-center", onClick: () => setShowPassed((v) => !v), children: showPassed ? '▲ Hide passed checks' : `▼ Show ${passed.length} passed check${passed.length > 1 ? 's' : ''}` }), showPassed && passed.map((c, i) => (_jsxs("div", { className: "check-row check-pass", children: [_jsx("span", { className: "check-icon", children: "\u2713" }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "font-semibold", children: c.label }), _jsx("div", { className: "text-xs opacity-80 break-all", children: resolveDetail(c.detail) })] })] }, i)))] })), _jsxs("details", { className: "mt-3", children: [_jsx("summary", { className: "cursor-pointer text-xs text-on-surface-variant", children: "Raw values" }), _jsxs("div", { className: "mt-2 text-xs", children: [_jsxs(RawSection, { title: `${homeChain.name} — send side`, children: [_jsx(RawRow, { label: "EID", value: String(homeChain.eid) }), _jsx(RawRow, { label: "Send library", value: result.homeSendLib }), _jsx(RawRow, { label: "Executor", value: result.homeExecutor?.executor }), _jsx(RawRow, { label: "Max msg size", value: result.homeExecutor ? `${result.homeExecutor.maxMessageSize} bytes` : null }), _jsx(RawRow, { label: "DVNs (required)", value: result.homeDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveHome)).join('\n') ?? null }), _jsx(RawRow, { label: "Confirmations", value: result.homeDVN?.confirmations != null ? String(result.homeDVN.confirmations) : null }), _jsx(RawRow, { label: "Enforced options", value: result.homeEnforcedOptions }), _jsx(RawRow, { label: "Peer bytes32", value: result.homePeer }), _jsx(RawRow, { label: "Delegate", value: result.homeDelegate }), isAdapter && result.homeRateLimit !== undefined && (_jsx(RawRow, { label: "Rate limit", value: result.homeRateLimit ? `${String(result.homeRateLimit.limit)} / ${result.homeRateLimit.window}s` : 'none' }))] }), _jsxs(RawSection, { title: `${remoteChain.name} — receive side`, children: [_jsx(RawRow, { label: "EID", value: String(remoteChain.eid) }), _jsx(RawRow, { label: "Receive library", value: result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : null }), _jsx(RawRow, { label: "DVNs (required)", value: result.remoteDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveRemote)).join('\n') ?? null }), _jsx(RawRow, { label: "Confirmations", value: result.remoteDVN?.confirmations != null ? String(result.remoteDVN.confirmations) : null }), _jsx(RawRow, { label: "Enforced options", value: result.remoteEnforcedOptions }), _jsx(RawRow, { label: "Peer bytes32", value: result.remotePeer })] })] })] })] }))] }));
}
function SummaryItem({ label, value }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "label mb-0.5", children: label }), _jsx("div", { className: `text-xs break-all ${value === '—' ? 'text-on-surface-variant/40' : 'text-on-surface'}`, children: value })] }));
}
function RawSection({ title, children }) {
    return (_jsxs("div", { className: "mb-3", children: [_jsx("div", { className: "text-on-surface-variant font-semibold mb-1", children: title }), children] }));
}
function RawRow({ label, value }) {
    return (_jsxs("div", { className: "flex gap-2 mb-0.5", children: [_jsx("span", { className: "text-on-surface-variant min-w-[140px]", children: label }), _jsx("span", { className: "break-all text-on-surface", children: value ?? '—' })] }));
}
function Field({ label, value, onChange }) {
    return (_jsxs("div", { className: "mb-2", children: [_jsx("div", { className: "label", children: label }), _jsx("input", { className: "input", value: value, onChange: (e) => onChange(e.target.value), spellCheck: false })] }));
}
