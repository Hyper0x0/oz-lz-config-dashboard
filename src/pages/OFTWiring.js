import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { LZ_CHAINS, isStarknet, isEvm } from '@/config/lzCatalog';
import { sortDvns } from '@/utils/cairoLzConfig';
/** Returns false for '', '0x', or any string that would throw BigInt(). */
function isAddr(s) { return s.length > 2 && s !== '0x'; }
/** Safe bytes32 display from a hex address string. */
function addrToBytes32(addr) { return '0x' + BigInt(addr).toString(16).padStart(64, '0'); }
function toAnyEvm(c) { return { ...c, kind: 'evm' }; }
function starkChain(testnet) {
    const base = testnet ? STARKNET_TESTNET : STARKNET_MAINNET;
    return { kind: 'starknet', isTestnet: testnet, ...base };
}
export function OFTWiring() {
    const evm = useEvmWallet();
    const stark = useStarknetWallet();
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
                const evmEntries = LZ_CHAINS
                    .filter((c) => c.isTestnet === isTestnet && c.eid !== evmHome.eid)
                    .map((c) => ({ eid: c.eid, name: c.name }));
                const result = await wiring.readAllPeers(homeAddr, evmHome.rpc, [...evmEntries, starkEntry]);
                setPeers(result);
            }
            else if (starkHome) {
                // Starknet home: call get_peer(eid) on the Cairo OFT for all EVM chains
                const evmEntries = LZ_CHAINS
                    .filter((c) => c.isTestnet === isTestnet)
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
    return (_jsxs("div", { children: [_jsxs("div", { className: "topbar", children: [_jsx("h2", { children: "OFT Wiring" }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx(EvmWalletButton, { address: evm.address, chainId: evm.chainId, chainName: evmHome?.name ?? '', onConnect: evm.connect, onSwitchNetwork: evmHome ? () => evm.switchNetwork(evmHome.chainId) : undefined, targetChainId: evmHome?.chainId ?? 0 }), hasStarknet && (_jsx(StarknetWalletButton, { address: stark.address, onConnect: stark.connect, onDisconnect: stark.disconnect }))] })] }), _jsxs("div", { style: { display: 'flex', gap: 16, alignItems: 'flex-start' }, children: [_jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("section", { className: "card", children: [_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }, children: [_jsx("button", { className: `btn${isTestnet ? '' : ' btn-ghost'}`, onClick: () => handleNetworkToggle(true), children: "Testnet" }), _jsx("button", { className: `btn${!isTestnet ? '' : ' btn-ghost'}`, onClick: () => handleNetworkToggle(false), children: "Mainnet" }), chainsLoading && _jsx("span", { style: { fontSize: 12, color: '#888' }, children: "Loading chains\u2026" }), !chainsLoading && _jsxs("span", { style: { fontSize: 12, color: '#555' }, children: [evmChains.length, " EVM chains"] }), _jsxs("div", { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }, children: [_jsx("span", { style: { fontSize: 12, color: '#555' }, children: "Wire:" }), _jsx("button", { className: `btn${mode === 'bridge-oft' ? '' : ' btn-ghost'}`, onClick: () => setMode('bridge-oft'), children: "Adapter \u2194 OFT" }), _jsx("button", { className: `btn${mode === 'oft-oft' ? '' : ' btn-ghost'}`, onClick: () => setMode('oft-oft'), children: "OFT \u2194 OFT" })] })] }), _jsxs("div", { className: "form-grid", children: [_jsxs("div", { children: [_jsxs("div", { className: "label", children: [homeLabel, " chain (home) \u2014 EID ", home.eid] }), _jsx(AnyChainSelect, { evmChains: evmChains, isTestnet: isTestnet, selected: home, onSelect: (c) => { setHomeChain(c); clearData(); setTab('verify'); } })] }), _jsxs("div", { children: [_jsxs("div", { className: "label", children: ["OFT chain (remote) \u2014 EID ", remote.eid] }), _jsx(AnyChainSelect, { evmChains: evmChains, isTestnet: isTestnet, selected: remote, onSelect: (c) => { setRemoteChain(c); clearData(); setTab('verify'); } })] })] }), _jsxs("div", { className: "form-grid", style: { marginTop: 8 }, children: [_jsx(Field, { label: `${homeLabel} address (home)`, value: homeAddr, onChange: setHomeAddr }), _jsx(Field, { label: "OFT address (remote)", value: remoteAddr, onChange: setRemoteAddr })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }, children: [(bothEvm || hasStarknet) && (_jsx("button", { className: "btn btn-primary", onClick: handleFetch, disabled: fetching || !homeAddr || !remoteAddr, children: fetching ? 'Fetching…' : 'Fetch data' })), evmHome && evm.isConnected && evm.chainId === evmHome.chainId && (_jsxs("span", { style: { fontSize: 12, color: '#6bcb77' }, children: ["\u2713 EVM wallet on ", evmHome.name] })), evmHome && evm.isConnected && evm.chainId !== evmHome.chainId && (_jsxs("span", { style: { fontSize: 12, color: '#888' }, children: ["Using public RPC \u2014 switch wallet to ", evmHome.name, " to configure"] })), hasStarknet && stark.isConnected && (_jsx("span", { style: { fontSize: 12, color: '#6bcb77' }, children: "\u2713 Starknet wallet connected" })), hasStarknet && !stark.isConnected && (_jsx("span", { style: { fontSize: 12, color: '#888' }, children: "Connect Starknet wallet to configure" }))] }), tokenInfo && (_jsxs("div", { className: "token-banner", children: [_jsx(TokenBadge, { label: `${homeLabel} locks`, name: tokenInfo.tokenName, symbol: tokenInfo.tokenSymbol }), _jsx("span", { style: { color: '#444', fontSize: 18 }, children: "\u2194" }), _jsx(TokenBadge, { label: "OFT mints", name: tokenInfo.peerName, symbol: tokenInfo.peerSymbol })] })), tokenInfoError && (_jsx("div", { style: { fontSize: 12, color: '#ff6b6b', marginTop: 8 }, children: tokenInfoError }))] }), (bothEvm || hasStarknet) && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: 8 }, children: [_jsx("button", { className: `btn${tab === 'verify' ? '' : ' btn-ghost'}`, onClick: () => setTab('verify'), children: "Verify" }), _jsx("button", { className: `btn${tab === 'configure' ? '' : ' btn-ghost'}`, onClick: () => setTab('configure'), children: "Configure" })] }), tab === 'verify' && bothEvm && evmHome && evmRemote && (_jsx(VerifyPanel, { homeChain: evmHome, remoteChain: evmRemote, verifying: verifying, result: verifyResult, onVerify: handleVerify, isAdapter: mode === 'bridge-oft' })), tab === 'verify' && hasStarknet && (_jsx(StarknetVerifyPanel, { home: home, remote: remote, homeAddr: homeAddr, remoteAddr: remoteAddr, cairo: cairo, cairoEndpoint: cairoEndpoint, readEvmSide: readEvmSideForStarknet, fetchTick: starkFetchTick })), tab === 'configure' && bothEvm && evmHome && evmRemote && (_jsx(GuidedConfigure, { homeChain: evmHome, remoteChain: evmRemote, adapterAddr: homeAddr, peerAddr: remoteAddr, connectedChainId: evm.chainId, isConnected: evm.isConnected, signer: evm.signer, onSwitchNetwork: evm.switchNetwork, wiring: wiring, verifyResult: verifyResult, isAdapter: mode === 'bridge-oft' })), tab === 'configure' && hasStarknet && (_jsx(StarknetConfigurePanel, { home: home, remote: remote, homeAddr: homeAddr, remoteAddr: remoteAddr, wiringMode: mode, stark: stark, cairo: cairo, cairoEndpoint: cairoEndpoint, wiring: wiring, evm: evm, verifyResult: verifyResult }))] }))] }), _jsx("div", { style: { width: 300, flexShrink: 0, position: 'sticky', top: 16 }, children: _jsx(PeersSidebar, { peers: peers, scanning: peersScanning, error: peersError, canScan: canScanPeers, bridgeAddr: homeAddr, chainName: home.name, isTestnet: isTestnet, onScan: handleScanPeers }) })] })] }));
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
    const displayName = `${selected.name} — EID ${selected.eid}`;
    return (_jsxs("div", { ref: ref, style: { position: 'relative' }, children: [_jsxs("button", { className: "input", style: { textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    ...(isSelectedStark ? { borderColor: '#3a2010', color: '#ff7e33' } : {}) }, onClick: () => setOpen((v) => !v), type: "button", children: [_jsx("span", { children: displayName }), _jsx("span", { style: { color: '#555', fontSize: 11, marginLeft: 8 }, children: open ? '▲' : '▼' })] }), open && (_jsxs("div", { className: "chain-dropdown", children: [_jsxs("div", { className: `chain-option${isSelectedStark ? ' chain-option-active' : ''}`, style: { borderBottom: '1px solid #2a2a2a', color: isSelectedStark ? '#ff7e33' : '#ff7e33aa' }, onClick: () => { onSelect(stark); setOpen(false); }, children: [_jsx("span", { children: stark.name }), _jsxs("span", { style: { fontSize: 11 }, children: ["EID ", stark.eid] })] }), _jsx("div", { style: { padding: '6px 8px', borderBottom: '1px solid #2a2a2a' }, children: _jsx("input", { ref: inputRef, className: "input", placeholder: "Search EVM chain by name or EID\u2026", value: query, onChange: (e) => setQuery(e.target.value), style: { padding: '5px 8px' } }) }), _jsxs("div", { style: { overflowY: 'auto', maxHeight: 220 }, children: [filteredEvm.length === 0 && (_jsx("div", { style: { padding: '10px 12px', color: '#555', fontSize: 13 }, children: "No chains match" })), filteredEvm.map((c) => (_jsxs("div", { className: `chain-option${!isSelectedStark && selected.eid === c.eid ? ' chain-option-active' : ''}`, onClick: () => { onSelect(toAnyEvm(c)); setOpen(false); }, children: [_jsx("span", { children: c.name }), _jsxs("span", { style: { color: '#555', fontSize: 11 }, children: ["EID ", c.eid] })] }, c.eid)))] })] }))] }));
}
function CheckRow({ label, passed, detail, severity = 'critical' }) {
    const cls = passed ? 'check-pass' : severity === 'warning' ? 'check-warn' : 'check-critical';
    return (_jsxs("div", { className: `check-row ${cls}`, children: [_jsx("span", { className: "check-icon", children: passed ? '✓' : '✗' }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 600 }, children: label }), detail && _jsx("div", { style: { fontSize: 12, opacity: 0.8, wordBreak: 'break-all' }, children: detail })] })] }));
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
    return (_jsxs("section", { className: "card", children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, children: [_jsxs("div", { children: [_jsx("h3", { style: { margin: 0 }, children: "Pathway verification" }), _jsxs("span", { style: { color: '#888', fontSize: 13 }, children: [home.name, " (EID ", home.eid, ") \u2194 ", remote.name, " (EID ", remote.eid, ")"] })] }), _jsx("button", { className: "btn btn-primary", onClick: runChecks, disabled: checking || !isAddr(cairoAddr) || !isAddr(evmAddr), children: checking ? 'Checking…' : 'Run checks' })] }), !done && !checking && (_jsxs("p", { style: { color: '#666', fontSize: 13 }, children: ["Enter both contract addresses above, then press ", _jsx("strong", { children: "Run checks" }), " to read on-chain state from both endpoints. No wallet required."] })), error && _jsx("div", { className: "check-row check-critical", children: _jsx("span", { children: error }) }), evmState && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }, children: [evmChainData.name, " (send \u2192 Starknet)"] }), _jsx(CheckRow, { label: "Send library set", passed: !!evmState.sendLib && evmState.sendLib !== '0x0000000000000000000000000000000000000000', detail: evmState.sendLib ?? 'Not set' }), _jsx(CheckRow, { label: "Executor configured", passed: !!evmState.executor && evmState.executor.executor !== '0x0000000000000000000000000000000000000000', detail: evmState.executor ? `${evmState.executor.executor} (max ${evmState.executor.maxMessageSize} bytes)` : 'Not configured' }), _jsx(CheckRow, { label: "DVNs configured (send)", passed: !!evmState.dvnSend && evmState.dvnSend.requiredDVNCount > 0, detail: evmState.dvnSend?.requiredDVNCount ? `${evmState.dvnSend.requiredDVNCount} required: ${evmState.dvnSend.requiredDVNs.join(', ')}` : 'No DVNs set' }), _jsx(CheckRow, { label: "Enforced options set", passed: !!evmState.enforcedOptions && evmState.enforcedOptions !== '0x', detail: evmState.enforcedOptions ?? 'Not set' }), _jsx(CheckRow, { label: "Delegate set", passed: !!evmState.delegate && evmState.delegate !== '0x0000000000000000000000000000000000000000', detail: evmState.delegate ?? 'Not set', severity: "warning" }), _jsx(CheckRow, { label: "Peer set (EVM \u2192 Starknet)", passed: !!evmState.peer && evmState.peer !== ZERO64 && expectedEvmPeer !== null && evmState.peer.toLowerCase() === expectedEvmPeer.toLowerCase(), detail: evmState.peer && evmState.peer !== ZERO64 ? evmState.peer : 'Not set' }), _jsxs("div", { style: { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }, children: [evmChainData.name, " (receive \u2190 Starknet)"] }), _jsx(CheckRow, { label: "Receive library set", passed: !!evmState.recvLib && evmState.recvLib !== '0x0000000000000000000000000000000000000000' && !evmState.recvLibIsDefault, detail: evmState.recvLib ? `${evmState.recvLib}${evmState.recvLibIsDefault ? ' (default — set explicitly)' : ''}` : 'Not set', severity: evmState.recvLibIsDefault ? 'warning' : 'critical' }), _jsx(CheckRow, { label: "DVNs configured (receive)", passed: !!evmState.dvnRecv && evmState.dvnRecv.requiredDVNCount > 0, detail: evmState.dvnRecv?.requiredDVNCount ? `${evmState.dvnRecv.requiredDVNCount} required: ${evmState.dvnRecv.requiredDVNs.join(', ')}` : 'No DVNs set' })] })), starkState && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { fontSize: 11, fontWeight: 700, color: '#ff7e33', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }, children: [starkChainData.name, " (send \u2192 EVM)"] }), _jsx(CheckRow, { label: "Send library set", passed: !!starkState.sendLib, detail: starkState.sendLib ?? 'Not set' }), _jsx(CheckRow, { label: "Enforced options set", passed: starkState.enforcedOptions, detail: starkState.enforcedOptions ? 'Set' : 'Not set' }), _jsx(CheckRow, { label: "Delegate set", passed: !!starkState.delegate, detail: starkState.delegate ?? 'Not set', severity: "warning" }), _jsx(CheckRow, { label: "Peer set (Starknet \u2192 EVM)", passed: !!starkState.peer && starkState.peer !== ZERO64 && expectedCairoPeer !== null && starkState.peer.toLowerCase() === expectedCairoPeer.toLowerCase(), detail: starkState.peer && starkState.peer !== ZERO64 ? starkState.peer : 'Not set' }), _jsxs("div", { style: { fontSize: 11, fontWeight: 700, color: '#ff7e33', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }, children: [starkChainData.name, " (receive \u2190 EVM)"] }), _jsx(CheckRow, { label: "Receive library set", passed: !!starkState.recvLib && !starkState.recvLibIsDefault, detail: starkState.recvLib ? `${starkState.recvLib}${starkState.recvLibIsDefault ? ' (default)' : ''}` : 'Not set', severity: starkState.recvLibIsDefault ? 'warning' : 'critical' })] }))] }));
}
// ── Starknet configure panel ──────────────────────────────────────────────────
function StarknetConfigurePanel({ home, remote, homeAddr, remoteAddr, wiringMode, stark, cairo, cairoEndpoint, wiring, evm, verifyResult }) {
    const starkChainData = (isStarknet(home) ? home : remote);
    const evmChainData = (isStarknet(home) ? remote : home);
    const cairoAddr = isStarknet(home) ? homeAddr : remoteAddr;
    const evmAddr = isStarknet(home) ? remoteAddr : homeAddr;
    const evmIsHome = isEvm(home);
    const isAdapter = wiringMode === 'bridge-oft';
    // Fake LZChain for Starknet remote (only eid used by GuidedConfigure)
    const starkAsRemote = {
        eid: starkChainData.eid, chainId: -1, chainKey: starkChainData.chainKey,
        name: starkChainData.name, endpoint: starkChainData.endpoint,
        rpc: starkChainData.rpc, isTestnet: starkChainData.isTestnet,
        sendLib: starkChainData.sendLib, receiveLib: starkChainData.receiveLib,
    };
    const starkConnected = stark.isConnected;
    const starkHint = !starkConnected ? _jsx("span", { style: { fontSize: 12, color: '#888' }, children: "Connect Starknet wallet first" }) : null;
    // Tx states
    const [enforcedOptsTx, setEnforcedOptsTx] = useState({ status: 'idle' });
    const [libTx, setLibTx] = useState({ status: 'idle' });
    const [sendConfigTx, setSendConfigTx] = useState({ status: 'idle' });
    const [executorTx, setExecutorTx] = useState({ status: 'idle' });
    const [recvConfigTx, setRecvConfigTx] = useState({ status: 'idle' });
    const [delegateTx, setDelegateTx] = useState({ status: 'idle' });
    const [setPeerTx, setSetPeerTx] = useState({ status: 'idle' });
    // Field state — auto-fill library address from chain config (sendLib == receiveLib on Starknet)
    const [cairoGas, setCairoGas] = useState('80000');
    const [cairoLib, setCairoLib] = useState(starkChainData.sendLib ?? '');
    const [cairoGracePeriod, setCairoGracePeriod] = useState('0');
    const [cairoConfirm, setCairoConfirm] = useState(starkChainData.isTestnet ? '1' : '15');
    const [cairoDelegate, setCairoDelegate] = useState('');
    const [cairoExecutor, setCairoExecutor] = useState(starkChainData.executor ?? '');
    const [cairoMaxMsgSize, setCairoMaxMsgSize] = useState('10000');
    // DVN selection for S4/S5 (keyed by address → DVNProvider)
    const [sendDvns, setSendDvns] = useState(new Map());
    const [recvDvns, setRecvDvns] = useState(new Map());
    const { dvns: availableDvns, loading: dvnsLoading } = useDVNCatalog(starkChainData.chainKey);
    function toggleDvn(side, addr, provider) {
        const setter = side === 'send' ? setSendDvns : setRecvDvns;
        setter((prev) => {
            const next = new Map(prev);
            if (next.has(addr))
                next.delete(addr);
            else
                next.set(addr, provider);
            return next;
        });
    }
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingLeft: 4 }, children: [_jsx("span", { style: { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#555' }, children: "EVM" }), _jsxs("span", { style: { fontSize: 12, color: '#888' }, children: [evmChainData.name, " \u2014 EID ", evmChainData.eid] }), evm.isConnected && evm.chainId === evmChainData.chainId
                        ? _jsx("span", { style: { fontSize: 11, color: '#6bcb77', marginLeft: 'auto' }, children: "\u2713 connected" })
                        : _jsx("span", { style: { fontSize: 11, color: '#666', marginLeft: 'auto' }, children: "wallet not on this chain" })] }), _jsx(GuidedConfigure, { homeChain: evmChainData, remoteChain: starkAsRemote, adapterAddr: evmIsHome ? homeAddr : remoteAddr, peerAddr: evmIsHome ? remoteAddr : homeAddr, connectedChainId: evm.chainId, isConnected: evm.isConnected, signer: evm.signer, onSwitchNetwork: evm.switchNetwork, wiring: wiring, verifyResult: verifyResult, isAdapter: isAdapter, isRemoteEvm: false }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 6, paddingLeft: 4 }, children: [_jsx("span", { style: { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#ff7e33aa' }, children: "Starknet" }), _jsxs("span", { style: { fontSize: 12, color: '#ff7e3388' }, children: [starkChainData.name, " \u2014 EID ", starkChainData.eid] }), starkConnected
                        ? _jsx("span", { style: { fontSize: 11, color: '#6bcb77', marginLeft: 'auto' }, children: "\u2713 connected" })
                        : _jsx("span", { style: { fontSize: 11, color: '#666', marginLeft: 'auto' }, children: "wallet not connected" })] }), _jsxs(CairoStepCard, { n: "S1", title: "Enforced Options", subtitle: "Set minimum gas for lzReceive on the Starknet OFT.", children: [_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }, children: [_jsxs("div", { children: [_jsx("div", { className: "label", children: "Gas limit" }), _jsx("input", { className: "input", value: cairoGas, onChange: (e) => setCairoGas(e.target.value), style: { width: 140 } })] }), _jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr, onClick: async () => {
                                    setEnforcedOptsTx({ status: 'pending' });
                                    setEnforcedOptsTx(await cairoEndpoint.setEnforcedOptions(cairoAddr, evmChainData.eid, BigInt(cairoGas), starkChainData.rpc));
                                }, children: "Set on Starknet OFT" }), starkHint] }), _jsx(TxStatus, { state: enforcedOptsTx })] }), _jsxs(CairoStepCard, { n: "S2", title: "Message Libraries", subtitle: "Set send & receive library in one transaction. On Starknet both use the same address.", children: [_jsx("p", { className: "step-hint", children: "On Starknet, SendUln302 and ReceiveUln302 are the same contract \u2014 one address sets both directions." }), starkChainData.sendLib && (_jsxs("div", { style: { fontSize: 12, color: '#888', marginBottom: 8 }, children: ["Known lib: ", _jsx("span", { style: { color: '#aaa', fontFamily: 'monospace', fontSize: 11 }, children: starkChainData.sendLib })] })), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Library address (ULN302)" }), _jsx("input", { className: "input", value: cairoLib, onChange: (e) => setCairoLib(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Grace period (blocks, 0 = immediate)" }), _jsx("input", { className: "input", value: cairoGracePeriod, onChange: (e) => setCairoGracePeriod(e.target.value), style: { width: 120 } })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoLib, onClick: async () => {
                                    setLibTx({ status: 'pending' });
                                    setLibTx(await cairoEndpoint.setLibraries(starkChainData.endpoint, cairoAddr, evmChainData.eid, cairoLib, Number(cairoGracePeriod), starkChainData.rpc));
                                }, children: "Set Send & Receive Library" }), starkHint] }), _jsx(TxStatus, { state: libTx })] }), _jsxs(CairoStepCard, { n: "S4", title: "DVN Send Config", subtitle: "Select DVNs and set ULN send config on the Starknet Endpoint.", children: [_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Library address (from S2)" }), _jsx("input", { className: "input", value: cairoLib, onChange: (e) => setCairoLib(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Required DVNs" }), _jsx(CairoDVNPicker, { dvns: availableDvns, loading: dvnsLoading, selected: sendDvns, onToggle: (addr, p) => toggleDvn('send', addr, p) }), sendDvns.size === 0 && _jsx("div", { style: { fontSize: 11, color: '#888', marginTop: 4 }, children: "Select at least one DVN" })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Block confirmations" }), _jsx("input", { className: "input", value: cairoConfirm, onChange: (e) => setCairoConfirm(e.target.value), style: { width: 100 } })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoLib || sendDvns.size === 0, onClick: async () => {
                                    setSendConfigTx({ status: 'pending' });
                                    const sorted = sortDvns([...sendDvns.keys()]);
                                    setSendConfigTx(await cairoEndpoint.setUlnSendConfig(starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid, { confirmations: Number(cairoConfirm), requiredDvns: sorted }, starkChainData.rpc));
                                }, children: "Set DVN Send Config" }), starkHint] }), _jsx(TxStatus, { state: sendConfigTx })] }), _jsxs(CairoStepCard, { n: "S4b", title: "Executor Config", subtitle: "Set max message size and executor address for the send direction.", children: [_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Library address (from S2)" }), _jsx("input", { className: "input", value: cairoLib, onChange: (e) => setCairoLib(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Executor address" }), _jsx("input", { className: "input", value: cairoExecutor, onChange: (e) => setCairoExecutor(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Max message size (bytes)" }), _jsx("input", { className: "input", value: cairoMaxMsgSize, onChange: (e) => setCairoMaxMsgSize(e.target.value), style: { width: 120 } })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoLib || !cairoExecutor, onClick: async () => {
                                    setExecutorTx({ status: 'pending' });
                                    setExecutorTx(await cairoEndpoint.setExecutorConfig(starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid, { maxMessageSize: Number(cairoMaxMsgSize), executor: cairoExecutor }, starkChainData.rpc));
                                }, children: "Set Executor Config" }), starkHint] }), _jsx(TxStatus, { state: executorTx })] }), _jsxs(CairoStepCard, { n: "S5", title: "DVN Receive Config", subtitle: "Select DVNs and set ULN receive config on the Starknet Endpoint.", children: [_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Library address (from S2)" }), _jsx("input", { className: "input", value: cairoLib, onChange: (e) => setCairoLib(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Required DVNs" }), _jsx(CairoDVNPicker, { dvns: availableDvns, loading: dvnsLoading, selected: recvDvns, onToggle: (addr, p) => toggleDvn('recv', addr, p) }), recvDvns.size === 0 && _jsx("div", { style: { fontSize: 11, color: '#888', marginTop: 4 }, children: "Select at least one DVN" })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Block confirmations" }), _jsx("input", { className: "input", value: cairoConfirm, onChange: (e) => setCairoConfirm(e.target.value), style: { width: 100 } })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoLib || recvDvns.size === 0, onClick: async () => {
                                    setRecvConfigTx({ status: 'pending' });
                                    const sorted = sortDvns([...recvDvns.keys()]);
                                    setRecvConfigTx(await cairoEndpoint.setUlnReceiveConfig(starkChainData.endpoint, cairoAddr, cairoLib, evmChainData.eid, { confirmations: Number(cairoConfirm), requiredDvns: sorted }, starkChainData.rpc));
                                }, children: "Set DVN Receive Config" }), starkHint] }), _jsx(TxStatus, { state: recvConfigTx })] }), _jsxs(CairoStepCard, { n: "S6", title: "Delegate", subtitle: "Allow a delegate address to configure the endpoint on behalf of this OFT.", children: [_jsx("p", { className: "step-hint", children: "Required before configuring the endpoint from an external account." }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "Delegate address" }), _jsx("input", { className: "input", value: cairoDelegate, onChange: (e) => setCairoDelegate(e.target.value), placeholder: "0x\u2026", spellCheck: false })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !cairoDelegate, onClick: async () => {
                                    setDelegateTx({ status: 'pending' });
                                    setDelegateTx(await cairoEndpoint.setDelegate(cairoAddr, cairoDelegate, starkChainData.rpc));
                                }, children: "Set Delegate" }), starkHint] }), _jsx(TxStatus, { state: delegateTx })] }), _jsxs(CairoStepCard, { n: "S7", title: "Set Peer", subtitle: "Register the EVM contract address on the Starknet OFT. Do this last.", children: [_jsxs("div", { style: { fontSize: 13, marginBottom: 12 }, children: [_jsx("span", { className: "label", children: "EVM address \u2192 bytes32 (stored on Starknet)" }), _jsx("div", { className: "mono-block", children: isAddr(evmAddr) ? addrToBytes32(evmAddr) : '(enter EVM address above)' })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("button", { className: "btn btn-primary", disabled: !starkConnected || !cairoAddr || !isAddr(evmAddr), onClick: async () => {
                                    setSetPeerTx({ status: 'pending' });
                                    setSetPeerTx(await cairo.setPeer(cairoAddr, evmChainData.eid, evmAddr));
                                }, children: "Set Peer on Starknet OFT" }), starkHint] }), _jsx(TxStatus, { state: setPeerTx }), _jsxs("div", { style: { marginTop: 10, fontSize: 11, color: '#444' }, children: ["Starknet endpoint: ", _jsx("span", { style: { fontFamily: 'monospace' }, children: starkChainData.endpoint })] })] })] }));
}
// ── Cairo DVN picker (inline, no external search) ─────────────────────────────
function CairoDVNPicker({ dvns, loading, selected, onToggle }) {
    if (loading)
        return _jsx("div", { style: { fontSize: 12, color: '#888' }, children: "Loading DVNs\u2026" });
    if (dvns.length === 0)
        return (_jsx("div", { style: { fontSize: 12, color: '#888' }, children: "No DVNs found for this chain. Enter addresses manually if needed." }));
    return (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: dvns.map((p) => {
            const addr = p.address.toLowerCase();
            const checked = selected.has(addr);
            const initials = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
            return (_jsxs("label", { style: {
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    padding: '6px 8px', borderRadius: 5,
                    background: checked ? p.color + '15' : 'transparent',
                    border: `1px solid ${checked ? p.color + '66' : '#222'}`,
                }, children: [_jsx("input", { type: "checkbox", checked: checked, onChange: () => onToggle(addr, p) }), _jsx("span", { style: {
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 22, height: 22, borderRadius: '50%',
                            background: p.color + '33', border: `1px solid ${p.color}`,
                            color: p.color, fontSize: 9, fontWeight: 700, flexShrink: 0,
                        }, children: initials }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 600 }, children: p.name }), _jsxs("div", { style: { fontSize: 10, color: '#666', fontFamily: 'monospace' }, children: [p.address.slice(0, 12), "\u2026", p.address.slice(-6)] })] })] }, p.address));
        }) }));
}
function CairoStepCard({ n, title, subtitle, children }) {
    const [open, setOpen] = useState(true);
    return (_jsxs("div", { className: `step-card${open ? ' step-card-open' : ''}`, style: { marginTop: 6 }, children: [_jsxs("button", { className: "step-header", onClick: () => setOpen((v) => !v), children: [_jsx("span", { className: "step-num", style: { background: '#3a2010', color: '#ff7e33', borderColor: '#3a2010' }, children: n }), _jsxs("div", { style: { flex: 1, textAlign: 'left' }, children: [_jsx("div", { style: { fontWeight: 600 }, children: title }), _jsx("div", { style: { fontSize: 12, color: '#888' }, children: subtitle })] }), _jsx("span", { style: { color: '#666', fontSize: 12, marginLeft: 8 }, children: open ? '▲' : '▼' })] }), open && _jsx("div", { className: "step-body", children: children })] }));
}
// ── Peers sidebar ─────────────────────────────────────────────────────────────
function PeersSidebar({ peers, scanning, error, canScan, bridgeAddr, chainName, isTestnet, onScan }) {
    const connected = peers?.filter((p) => p.peer !== null) ?? [];
    const unset = peers?.filter((p) => p.peer === null) ?? [];
    const [showAll, setShowAll] = useState(false);
    return (_jsxs("div", { className: "card", style: { padding: '14px 16px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 700, fontSize: 14 }, children: "Connected Peers" }), _jsx("div", { style: { fontSize: 11, color: '#666', marginTop: 1 }, children: chainName || 'select home chain' })] }), _jsx("button", { className: "btn btn-primary", style: { fontSize: 12, padding: '4px 10px' }, disabled: !canScan || scanning, onClick: onScan, title: !canScan ? 'Enter a contract address and select home chain first' : '', children: scanning ? 'Scanning…' : 'Scan' })] }), !peers && !scanning && !error && (_jsxs("div", { style: { fontSize: 12, color: '#555', textAlign: 'center', padding: '20px 0' }, children: ["Enter a contract address above and press ", _jsx("strong", { children: "Scan" }), " to discover all connected chains."] })), scanning && (_jsxs("div", { style: { fontSize: 12, color: '#888', textAlign: 'center', padding: '20px 0' }, children: ["Querying ", isTestnet ? 'testnet' : 'mainnet', " chains\u2026"] })), error && (_jsxs("div", { style: { fontSize: 12, color: '#ff6b6b', wordBreak: 'break-all' }, children: ["Error: ", error] })), peers && !scanning && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: 10, fontSize: 12 }, children: [_jsxs("span", { style: { color: '#6bcb77', fontWeight: 600 }, children: [connected.length, " connected"] }), _jsxs("span", { style: { color: '#555' }, children: ["/ ", peers.length, " checked"] })] }), _jsxs("div", { style: { marginBottom: 10, padding: '6px 8px', background: '#0e0e1a', borderRadius: 5, border: '1px solid #2a2a3a' }, children: [_jsx("div", { style: { fontSize: 10, color: '#555', marginBottom: 2 }, children: "Adapter" }), _jsx("div", { style: { fontFamily: 'monospace', fontSize: 11, color: '#aaa', wordBreak: 'break-all' }, children: bridgeAddr })] }), connected.length === 0 && (_jsx("div", { style: { fontSize: 12, color: '#666', textAlign: 'center', padding: '8px 0' }, children: "No peers set" })), connected.map((p) => (_jsx(PeerRow, { entry: p }, p.eid))), unset.length > 0 && (_jsxs(_Fragment, { children: [_jsx("button", { className: "btn btn-ghost", style: { fontSize: 11, width: '100%', marginTop: 8, justifyContent: 'center' }, onClick: () => setShowAll((v) => !v), children: showAll ? '▲ Hide' : `▼ Show ${unset.length} unset chain${unset.length > 1 ? 's' : ''}` }), showAll && unset.map((p) => (_jsx(PeerRow, { entry: p }, p.eid)))] }))] }))] }));
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
    return (_jsxs("div", { style: {
            display: 'flex', flexDirection: 'column', gap: 2,
            padding: '8px 10px', marginBottom: 6,
            background: isSet ? '#0a120a' : '#0e0e0e',
            border: `1px solid ${isSet ? '#1a3a1a' : '#1a1a1a'}`,
            borderRadius: 6,
            opacity: isSet ? 1 : 0.5,
        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [_jsxs("span", { style: { fontSize: 13, fontWeight: 600, color: isSet ? '#ccc' : '#555' }, children: [_jsx("span", { style: { marginRight: 6, fontSize: 10 }, children: isSet ? '🟢' : '⚪' }), entry.name] }), _jsxs("span", { style: { fontSize: 10, color: '#555' }, children: ["EID ", entry.eid] })] }), isSet && (_jsxs("div", { style: { fontFamily: 'monospace', fontSize: 11, color: '#7a9c7a', wordBreak: 'break-all' }, children: [displayPeer.slice(0, 14), "\u2026", displayPeer.slice(-8)] })), entry.error && (_jsx("div", { style: { fontSize: 10, color: '#ff6b6b' }, children: "read error" }))] }));
}
// ── Token banner ──────────────────────────────────────────────────────────────
function TokenBadge({ label, name, symbol }) {
    return (_jsxs("div", { style: { textAlign: 'center' }, children: [_jsx("div", { className: "label", style: { marginBottom: 2 }, children: label }), _jsx("div", { style: { fontWeight: 700, fontSize: 15 }, children: symbol }), _jsx("div", { style: { fontSize: 12, color: '#888' }, children: name })] }));
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
    return (_jsxs("section", { className: "card", children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, children: [_jsxs("div", { children: [_jsx("h3", { style: { margin: 0 }, children: "Pathway verification" }), _jsxs("span", { style: { color: '#888', fontSize: 13 }, children: [homeChain.name, " (EID ", homeChain.eid, ") \u2192 ", remoteChain.name, " (EID ", remoteChain.eid, ")"] })] }), _jsx("button", { className: "btn", onClick: onVerify, disabled: verifying, children: verifying ? 'Checking…' : 'Run checks' })] }), !result && !verifying && (_jsxs("p", { style: { color: '#666', fontSize: 13 }, children: ["Press ", _jsx("strong", { children: "Run checks" }), " to read on-chain config from both endpoints."] })), result?.error && (_jsx("div", { className: "check-row check-critical", children: _jsxs("span", { children: ["RPC error: ", result.error] }) })), result && !result.error && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "verify-summary", children: [_jsx(SummaryItem, { label: "Executor", value: result.homeExecutor?.executor ?? '—' }), _jsx(SummaryItem, { label: "Max msg size", value: result.homeExecutor ? `${result.homeExecutor.maxMessageSize} bytes` : '—' }), _jsx(SummaryItem, { label: "Send lib", value: result.homeSendLib ?? '—' }), _jsx(SummaryItem, { label: "Recv lib", value: result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : '—' }), _jsx(SummaryItem, { label: "Confirmations", value: result.homeDVN ? `${result.homeDVN.confirmations} blocks` : '—' }), isAdapter && result.homeRateLimit !== undefined && (_jsx(SummaryItem, { label: "Rate limit", value: result.homeRateLimit ? `${String(result.homeRateLimit.limit)} / ${result.homeRateLimit.window}s` : 'disabled' }))] }), _jsxs("div", { style: { display: 'flex', gap: 12, margin: '12px 0', fontSize: 13 }, children: [criticalFailed.length > 0 && _jsxs("span", { style: { color: '#ff6b6b' }, children: [criticalFailed.length, " critical"] }), warnFailed.length > 0 && _jsxs("span", { style: { color: '#ffd93d' }, children: [warnFailed.length, " warning", warnFailed.length > 1 ? 's' : ''] }), criticalFailed.length === 0 && warnFailed.length === 0 && _jsx("span", { style: { color: '#6bcb77' }, children: "All checks passed" }), _jsxs("span", { style: { color: '#555' }, children: [passed.length, "/", result.checks.length, " passed"] })] }), result.checks.map((c, i) => (_jsxs("div", { className: `check-row ${c.passed ? 'check-pass' : c.severity === 'critical' ? 'check-critical' : c.severity === 'warning' ? 'check-warn' : 'check-info'}`, children: [_jsx("span", { className: "check-icon", children: c.passed ? '✓' : c.severity === 'critical' ? '✗' : c.severity === 'warning' ? '!' : 'i' }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 600 }, children: c.label }), _jsx("div", { style: { fontSize: 12, opacity: 0.8, wordBreak: 'break-all' }, children: resolveDetail(c.detail) })] })] }, i))), _jsxs("details", { style: { marginTop: 12 }, children: [_jsx("summary", { style: { cursor: 'pointer', color: '#888', fontSize: 13 }, children: "Raw values" }), _jsxs("div", { style: { marginTop: 8, fontSize: 12 }, children: [_jsxs(RawSection, { title: `${homeChain.name} — send side`, children: [_jsx(RawRow, { label: "EID", value: String(homeChain.eid) }), _jsx(RawRow, { label: "Send library", value: result.homeSendLib }), _jsx(RawRow, { label: "Executor", value: result.homeExecutor?.executor }), _jsx(RawRow, { label: "Max msg size", value: result.homeExecutor ? `${result.homeExecutor.maxMessageSize} bytes` : null }), _jsx(RawRow, { label: "DVNs (required)", value: result.homeDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveHome)).join('\n') ?? null }), _jsx(RawRow, { label: "Confirmations", value: result.homeDVN?.confirmations != null ? String(result.homeDVN.confirmations) : null }), _jsx(RawRow, { label: "Enforced options", value: result.homeEnforcedOptions }), _jsx(RawRow, { label: "Peer bytes32", value: result.homePeer }), _jsx(RawRow, { label: "Delegate", value: result.homeDelegate }), isAdapter && result.homeRateLimit !== undefined && (_jsx(RawRow, { label: "Rate limit", value: result.homeRateLimit ? `${String(result.homeRateLimit.limit)} / ${result.homeRateLimit.window}s` : 'none' }))] }), _jsxs(RawSection, { title: `${remoteChain.name} — receive side`, children: [_jsx(RawRow, { label: "EID", value: String(remoteChain.eid) }), _jsx(RawRow, { label: "Receive library", value: result.remoteReceiveLib ? `${result.remoteReceiveLib}${result.remoteReceiveLibIsDefault ? ' (default)' : ''}` : null }), _jsx(RawRow, { label: "DVNs (required)", value: result.remoteDVN?.requiredDVNs.map((a) => dvnLabel(a, resolveRemote)).join('\n') ?? null }), _jsx(RawRow, { label: "Confirmations", value: result.remoteDVN?.confirmations != null ? String(result.remoteDVN.confirmations) : null }), _jsx(RawRow, { label: "Enforced options", value: result.remoteEnforcedOptions }), _jsx(RawRow, { label: "Peer bytes32", value: result.remotePeer })] })] })] })] }))] }));
}
function SummaryItem({ label, value }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "label", style: { marginBottom: 2 }, children: label }), _jsx("div", { style: { fontSize: 12, wordBreak: 'break-all', color: value === '—' ? '#444' : '#ccc' }, children: value })] }));
}
function RawSection({ title, children }) {
    return (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("div", { style: { color: '#aaa', marginBottom: 4 }, children: title }), children] }));
}
function RawRow({ label, value }) {
    return (_jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: 2 }, children: [_jsx("span", { style: { color: '#666', minWidth: 140 }, children: label }), _jsx("span", { style: { wordBreak: 'break-all' }, children: value ?? '—' })] }));
}
function Field({ label, value, onChange }) {
    return (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: label }), _jsx("input", { className: "input", value: value, onChange: (e) => onChange(e.target.value), spellCheck: false })] }));
}
