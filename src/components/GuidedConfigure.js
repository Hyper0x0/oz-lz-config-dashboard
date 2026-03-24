import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
import { TxStatus } from '@/components/TxStatus';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import { useEndpointConfig } from '@/hooks/useEndpointConfig';
export function GuidedConfigure({ homeChain, remoteChain, adapterAddr, peerAddr, connectedChainId, isConnected, signer, onSwitchNetwork, wiring, verifyResult, isAdapter = true, isRemoteEvm = true, }) {
    const [openStep, setOpenStep] = useState(1);
    const toggle = (n) => setOpenStep((p) => (p === n ? null : n));
    return (_jsxs("div", { children: [_jsx(Step1Options, { open: openStep === 1, onToggle: () => toggle(1), homeChain: homeChain, remoteChain: remoteChain, adapterAddr: adapterAddr, peerAddr: peerAddr, connectedChainId: connectedChainId, isConnected: isConnected, onSwitchNetwork: onSwitchNetwork, wiring: wiring, verifyResult: verifyResult, isRemoteEvm: isRemoteEvm }), isAdapter && (_jsx(Step2RateLimit, { open: openStep === 2, onToggle: () => toggle(2), remoteChain: remoteChain, adapterAddr: adapterAddr, connectedChainId: connectedChainId, isConnected: isConnected, onSwitchNetwork: onSwitchNetwork, wiring: wiring, verifyResult: verifyResult })), _jsx(Step3Libraries, { open: openStep === 3, onToggle: () => toggle(3), homeChain: homeChain, remoteChain: remoteChain, adapterAddr: adapterAddr, peerAddr: peerAddr, connectedChainId: connectedChainId, isConnected: isConnected, signer: signer, onSwitchNetwork: onSwitchNetwork, verifyResult: verifyResult, isRemoteEvm: isRemoteEvm }), _jsx(Step4DVN, { open: openStep === 4, onToggle: () => toggle(4), homeChain: homeChain, remoteChain: remoteChain, adapterAddr: adapterAddr, peerAddr: peerAddr, connectedChainId: connectedChainId, isConnected: isConnected, signer: signer, onSwitchNetwork: onSwitchNetwork, verifyResult: verifyResult, isRemoteEvm: isRemoteEvm }), _jsx(Step5Peers, { open: openStep === 5, onToggle: () => toggle(5), homeChain: homeChain, remoteChain: remoteChain, adapterAddr: adapterAddr, peerAddr: peerAddr, connectedChainId: connectedChainId, isConnected: isConnected, onSwitchNetwork: onSwitchNetwork, wiring: wiring, verifyResult: verifyResult, isRemoteEvm: isRemoteEvm })] }));
}
// ── Shared components ─────────────────────────────────────────────────────────
function StepCard({ n, title, subtitle, statusBadge, open, onToggle, children }) {
    return (_jsxs("div", { className: `step-card${open ? ' step-card-open' : ''}`, children: [_jsxs("button", { className: "step-header", onClick: onToggle, children: [_jsx("span", { className: "step-num", children: n }), _jsxs("div", { style: { flex: 1, textAlign: 'left' }, children: [_jsx("div", { style: { fontWeight: 600 }, children: title }), _jsx("div", { style: { fontSize: 12, color: '#888' }, children: subtitle })] }), statusBadge, _jsx("span", { style: { color: '#666', fontSize: 12, marginLeft: 8 }, children: open ? '▲' : '▼' })] }), open && _jsx("div", { className: "step-body", children: children })] }));
}
function ChainSwitch({ label, requiredChainId, requiredChainName, connectedChainId, isConnected, onSwitch }) {
    const ok = isConnected && connectedChainId === requiredChainId;
    return (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }, children: [_jsx("span", { style: { color: '#888' }, children: label }), ok
                ? _jsxs("span", { style: { color: '#6bcb77' }, children: ["\u2713 ", requiredChainName] })
                : _jsxs("button", { className: "btn", style: { padding: '3px 10px', fontSize: 11 }, onClick: onSwitch, children: ["Switch to ", requiredChainName] })] }));
}
function Field({ label, value, onChange, placeholder }) {
    return (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: label }), _jsx("input", { className: "input", value: value, onChange: (e) => onChange(e.target.value), placeholder: placeholder, spellCheck: false })] }));
}
function checkBadge(checks, label) {
    const c = checks.find((x) => x.label === label);
    if (!c)
        return null;
    return _jsx("span", { style: { fontSize: 11, color: c.passed ? '#6bcb77' : '#ff6b6b' }, children: c.passed ? '✓' : '✗' });
}
// ── DVN avatar + dropdown picker ─────────────────────────────────────────────
function DVNAvatar({ provider, size = 20 }) {
    const initials = provider.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return (_jsx("span", { style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: size, height: size, borderRadius: '50%',
            background: provider.color + '33', border: `1px solid ${provider.color}`,
            color: provider.color, fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
        }, children: initials }));
}
function DVNDropdown({ chainKey, selected, onToggle }) {
    const { dvns, loading, error } = useDVNCatalog(chainKey);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef(null);
    const inputRef = useRef(null);
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
    const selectedList = [...selected.values()];
    const filtered = dvns.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
    return (_jsxs("div", { ref: ref, style: { position: 'relative' }, children: [_jsxs("button", { className: "input dvn-trigger", onClick: () => setOpen((o) => !o), type: "button", style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }, children: [selectedList.length === 0
                        ? _jsx("span", { style: { color: '#666' }, children: "Select DVNs\u2026" })
                        : _jsx("span", { style: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }, children: selectedList.map((p) => (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4,
                                    background: p.color + '22', border: `1px solid ${p.color}66`,
                                    borderRadius: 4, padding: '1px 6px', fontSize: 11 }, children: [_jsx(DVNAvatar, { provider: p, size: 14 }), p.name] }, p.address))) }), _jsx("span", { style: { marginLeft: 'auto', color: '#666', fontSize: 11 }, children: open ? '▲' : '▼' })] }), open && (_jsxs("div", { className: "dvn-dropdown-list", children: [_jsx("div", { style: { padding: '6px 8px', borderBottom: '1px solid #2a2a2a' }, children: _jsx("input", { ref: inputRef, className: "input", placeholder: "Search DVNs\u2026", value: query, onChange: (e) => setQuery(e.target.value), onClick: (e) => e.stopPropagation(), style: { padding: '5px 8px' } }) }), loading && _jsx("div", { style: { padding: '8px 12px', color: '#888', fontSize: 13 }, children: "Loading\u2026" }), error && _jsxs("div", { style: { padding: '8px 12px', color: '#ff6b6b', fontSize: 13 }, children: ["Error: ", error] }), !loading && !error && filtered.length === 0 && (_jsx("div", { style: { padding: '8px 12px', color: '#666', fontSize: 13 }, children: dvns.length === 0 ? 'No DVNs for this chain' : 'No DVNs match' })), filtered.map((p) => {
                        const addr = p.address.toLowerCase();
                        const checked = selected.has(addr);
                        return (_jsxs("label", { className: "dvn-option", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: () => { onToggle(addr, p); }, onClick: (e) => e.stopPropagation() }), _jsx(DVNAvatar, { provider: p }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 600 }, children: p.name }), _jsxs("div", { style: { fontSize: 10, color: '#666' }, children: [p.address.slice(0, 12), "\u2026", p.address.slice(-6)] })] })] }, p.address));
                    })] }))] }));
}
// ── Step 1 — Enforced Options ─────────────────────────────────────────────────
function Step1Options({ open, onToggle, homeChain, remoteChain, adapterAddr, peerAddr, connectedChainId, isConnected, onSwitchNetwork, wiring, verifyResult, isRemoteEvm = true }) {
    const [gas, setGas] = useState('80000');
    const [adapterTx, setAdapterTx] = useState({ status: 'idle' });
    const [peerTx, setPeerTx] = useState({ status: 'idle' });
    const badge = verifyResult ? checkBadge(verifyResult.checks, 'Enforced options set (send side)') : null;
    return (_jsxs(StepCard, { n: 1, title: "Enforced Options", statusBadge: badge, open: open, onToggle: onToggle, subtitle: "Set minimum gas for lzReceive. Must be set on BOTH sides before opening peers.", children: [_jsx(Field, { label: "Gas limit for lzReceive", value: gas, onChange: setGas, placeholder: "80000" }), _jsx("p", { className: "step-hint", children: "Adapter sets options for messages going to the remote chain. Peer sets options for messages returning home. Both are required." }), _jsxs("div", { className: "step-actions", children: [_jsxs("div", { children: [_jsx(ChainSwitch, { label: "Adapter (home):", requiredChainId: homeChain.chainId, requiredChainName: homeChain.name, connectedChainId: connectedChainId, isConnected: isConnected, onSwitch: () => onSwitchNetwork(homeChain.chainId) }), _jsx("button", { className: "btn btn-primary", disabled: !isConnected || connectedChainId !== homeChain.chainId, onClick: async () => { setAdapterTx({ status: 'pending' }); setAdapterTx(await wiring.setEvmEnforcedOptions(adapterAddr, remoteChain.eid, BigInt(gas))); }, children: "Set on Adapter" }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TxStatus, { state: adapterTx }) })] }), isRemoteEvm && (_jsxs("div", { children: [_jsx(ChainSwitch, { label: "Peer (remote):", requiredChainId: remoteChain.chainId, requiredChainName: remoteChain.name, connectedChainId: connectedChainId, isConnected: isConnected, onSwitch: () => onSwitchNetwork(remoteChain.chainId) }), _jsx("button", { className: "btn btn-primary", disabled: !isConnected || connectedChainId !== remoteChain.chainId, onClick: async () => { setPeerTx({ status: 'pending' }); setPeerTx(await wiring.setEvmEnforcedOptions(peerAddr, homeChain.eid, BigInt(gas))); }, children: "Set on Peer" }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TxStatus, { state: peerTx }) })] }))] })] }));
}
// ── Step 2 — Rate Limit ───────────────────────────────────────────────────────
function Step2RateLimit({ open, onToggle, remoteChain, adapterAddr, connectedChainId, isConnected, onSwitchNetwork, wiring, verifyResult }) {
    const [limit, setLimit] = useState('1000000000000000000000000');
    const [window_, setWindow] = useState('3600');
    const [tx, setTx] = useState({ status: 'idle' });
    const rl = verifyResult?.homeRateLimit;
    const badge = verifyResult
        ? _jsx("span", { style: { fontSize: 11, color: rl ? '#6bcb77' : '#ffd93d' }, children: rl ? '✓' : '!' })
        : null;
    return (_jsxs(StepCard, { n: 2, title: "Rate Limit", statusBadge: badge, open: open, onToggle: onToggle, subtitle: "Cap how much can be bridged per time window. Adapter only.", children: [_jsx(Field, { label: "Limit (raw token units)", value: limit, onChange: setLimit }), _jsx(Field, { label: "Window (seconds)", value: window_, onChange: setWindow, placeholder: "3600" }), _jsx("p", { className: "step-hint", children: "Rate limits apply to the adapter only. Set limit to 0 to disable." }), _jsx("button", { className: "btn btn-primary", disabled: !isConnected, style: { marginBottom: 8 }, onClick: async () => { setTx({ status: 'pending' }); setTx(await wiring.setRateLimit(adapterAddr, remoteChain.eid, BigInt(limit), Number(window_))); }, children: "Set Rate Limit" }), !isConnected && (_jsx("button", { className: "btn", style: { marginLeft: 8 }, onClick: () => onSwitchNetwork(remoteChain.chainId), children: "Switch network" })), _jsx(TxStatus, { state: tx })] }));
}
// ── Step 3 — Libraries ────────────────────────────────────────────────────────
function Step3Libraries({ open, onToggle, homeChain, remoteChain, adapterAddr, peerAddr, connectedChainId, isConnected, signer, onSwitchNetwork, verifyResult, isRemoteEvm = true }) {
    const epConfig = useEndpointConfig(signer);
    // Pre-fill: verify result takes priority, then chain catalog defaults
    const currentSendLib = verifyResult?.homeSendLib ?? homeChain.sendLib ?? '';
    const currentRecvLib = verifyResult?.remoteReceiveLib ?? (isRemoteEvm ? remoteChain.receiveLib : undefined) ?? '';
    const [sendLib, setSendLib] = useState(currentSendLib);
    const [recvLib, setRecvLib] = useState(currentRecvLib);
    const [sendTx, setSendTx] = useState({ status: 'idle' });
    const [recvTx, setRecvTx] = useState({ status: 'idle' });
    // Keep fields in sync if chain changes
    useEffect(() => { if (!sendLib)
        setSendLib(currentSendLib); }, [currentSendLib]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!recvLib)
        setRecvLib(currentRecvLib); }, [currentRecvLib]); // eslint-disable-line react-hooks/exhaustive-deps
    const badge = verifyResult ? checkBadge(verifyResult.checks, 'Receive library set') : null;
    return (_jsxs(StepCard, { n: 3, title: "Message Libraries", statusBadge: badge, open: open, onToggle: onToggle, subtitle: "Assign explicit send/receive libs on EndpointV2. Defaults work on testnet.", children: [homeChain.isTestnet && (_jsxs("div", { className: "step-info", style: { marginBottom: 12 }, children: [_jsx("span", { style: { color: '#6bcb77' }, children: "\u2713 Testnet" }), " \u2014 default libraries are assigned automatically. You can still set explicit libs below if needed."] })), currentSendLib && (_jsxs("div", { style: { fontSize: 12, color: '#888', marginBottom: 8 }, children: ["Current send lib: ", _jsx("span", { style: { color: '#aaa' }, children: currentSendLib })] })), currentRecvLib && (_jsxs("div", { style: { fontSize: 12, color: '#888', marginBottom: 12 }, children: ["Current receive lib: ", _jsx("span", { style: { color: '#aaa' }, children: currentRecvLib })] })), _jsxs("div", { className: "step-actions", children: [_jsxs("div", { children: [_jsxs("div", { className: "label", style: { marginBottom: 8 }, children: ["Send library (home chain \u2014 ", homeChain.name, ")"] }), _jsx(Field, { label: "Send lib address (ULN302)", value: sendLib, onChange: setSendLib, placeholder: currentSendLib ?? '0x…' }), _jsx(ChainSwitch, { label: "Requires:", requiredChainId: homeChain.chainId, requiredChainName: homeChain.name, connectedChainId: connectedChainId, isConnected: isConnected, onSwitch: () => onSwitchNetwork(homeChain.chainId) }), _jsx("button", { className: "btn btn-primary", disabled: !isConnected || connectedChainId !== homeChain.chainId || !sendLib, onClick: async () => {
                                    setSendTx({ status: 'pending' });
                                    setSendTx(await epConfig.setSendLib(homeChain.endpoint, adapterAddr, remoteChain.eid, sendLib));
                                }, children: "Set Send Library" }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TxStatus, { state: sendTx }) })] }), isRemoteEvm && (_jsxs("div", { children: [_jsxs("div", { className: "label", style: { marginBottom: 8 }, children: ["Receive library (remote chain \u2014 ", remoteChain.name, ")"] }), _jsx(Field, { label: "Receive lib address (ULN302)", value: recvLib, onChange: setRecvLib, placeholder: currentRecvLib ?? '0x…' }), _jsx(ChainSwitch, { label: "Requires:", requiredChainId: remoteChain.chainId, requiredChainName: remoteChain.name, connectedChainId: connectedChainId, isConnected: isConnected, onSwitch: () => onSwitchNetwork(remoteChain.chainId) }), _jsx("button", { className: "btn btn-primary", disabled: !isConnected || connectedChainId !== remoteChain.chainId || !recvLib, onClick: async () => {
                                    setRecvTx({ status: 'pending' });
                                    setRecvTx(await epConfig.setReceiveLib(remoteChain.endpoint, peerAddr, homeChain.eid, recvLib));
                                }, children: "Set Receive Library" }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TxStatus, { state: recvTx }) })] }))] })] }));
}
// ── Step 4 — DVN & Executor ───────────────────────────────────────────────────
function Step4DVN({ open, onToggle, homeChain, remoteChain, adapterAddr, peerAddr, connectedChainId, isConnected, signer, onSwitchNetwork, verifyResult, isRemoteEvm = true }) {
    const epConfig = useEndpointConfig(signer);
    const { dvns: homeDVNs } = useDVNCatalog(homeChain.chainKey);
    const { dvns: remoteDVNs } = useDVNCatalog(remoteChain.chainKey);
    const [selectedHome, setSelectedHome] = useState(new Map());
    const [selectedRemote, setSelectedRemote] = useState(new Map());
    const [confirmations, setConfirmations] = useState('15');
    const [sendLib, setSendLib] = useState(verifyResult?.homeSendLib ?? homeChain.sendLib ?? '');
    const [recvLib, setRecvLib] = useState(verifyResult?.remoteReceiveLib ?? (isRemoteEvm ? remoteChain.receiveLib : undefined) ?? '');
    const [sendTx, setSendTx] = useState({ status: 'idle' });
    const [recvTx, setRecvTx] = useState({ status: 'idle' });
    const sendOk = verifyResult?.checks.find((c) => c.label === 'DVNs configured (send side)')?.passed;
    const recvOk = verifyResult?.checks.find((c) => c.label === 'DVNs configured (receive side)')?.passed;
    const badge = verifyResult
        ? _jsx("span", { style: { fontSize: 11, color: sendOk && recvOk ? '#6bcb77' : '#ff6b6b' }, children: sendOk && recvOk ? '✓' : '✗' })
        : null;
    function toggleHome(addr, p) {
        setSelectedHome((prev) => {
            const next = new Map(prev);
            if (next.has(addr))
                next.delete(addr);
            else
                next.set(addr, p);
            return next;
        });
    }
    function toggleRemote(addr, p) {
        setSelectedRemote((prev) => {
            const next = new Map(prev);
            if (next.has(addr))
                next.delete(addr);
            else
                next.set(addr, p);
            return next;
        });
    }
    // Resolve current DVN addresses to names for display
    const currentHomeDVNs = verifyResult?.homeDVN?.requiredDVNs ?? [];
    const currentRemoteDVNs = verifyResult?.remoteDVN?.requiredDVNs ?? [];
    function resolveAddr(addr, list) {
        return list.find((d) => d.address.toLowerCase() === addr.toLowerCase())?.name ?? addr.slice(0, 10) + '…';
    }
    return (_jsxs(StepCard, { n: 4, title: "DVN & Executor", statusBadge: badge, open: open, onToggle: onToggle, subtitle: "Configure which providers verify messages and minimum block confirmations.", children: [verifyResult && (currentHomeDVNs.length > 0 || currentRemoteDVNs.length > 0) && (_jsxs("div", { style: { marginBottom: 16 }, children: [_jsx("div", { className: "label", style: { marginBottom: 6 }, children: "Current on-chain DVNs" }), _jsxs("div", { className: "step-actions", children: [_jsxs("div", { children: [_jsxs("div", { style: { fontSize: 12, color: '#888', marginBottom: 4 }, children: [homeChain.name, " (send)"] }), currentHomeDVNs.length === 0
                                        ? _jsx("span", { style: { fontSize: 12, color: '#666' }, children: "None configured" })
                                        : currentHomeDVNs.map((addr) => (_jsx(DVNChip, { name: resolveAddr(addr, homeDVNs), addr: addr, color: homeDVNs.find((d) => d.address.toLowerCase() === addr.toLowerCase())?.color ?? '#888' }, addr))), verifyResult.homeDVN && (_jsxs("div", { style: { fontSize: 12, color: '#888', marginTop: 4 }, children: [verifyResult.homeDVN.confirmations.toString(), " block confirmations"] }))] }), _jsxs("div", { children: [_jsxs("div", { style: { fontSize: 12, color: '#888', marginBottom: 4 }, children: [remoteChain.name, " (receive)"] }), currentRemoteDVNs.length === 0
                                        ? _jsx("span", { style: { fontSize: 12, color: '#666' }, children: "None configured" })
                                        : currentRemoteDVNs.map((addr) => (_jsx(DVNChip, { name: resolveAddr(addr, remoteDVNs), addr: addr, color: remoteDVNs.find((d) => d.address.toLowerCase() === addr.toLowerCase())?.color ?? '#888' }, addr))), verifyResult.remoteDVN && (_jsxs("div", { style: { fontSize: 12, color: '#888', marginTop: 4 }, children: [verifyResult.remoteDVN.confirmations.toString(), " block confirmations"] }))] })] })] })), _jsxs("div", { className: "form-grid", style: { marginBottom: 4 }, children: [_jsx(Field, { label: "Block confirmations", value: confirmations, onChange: setConfirmations, placeholder: "15" }), _jsxs("div", { children: [_jsx("div", { className: "label", children: "Executor address" }), _jsx("div", { style: { fontSize: 11, color: '#555', marginBottom: 4 }, children: homeChain.executor ? `Auto-filled from LZ API` : 'Enter manually' }), _jsx("input", { className: "input", value: homeChain.executor ?? '', readOnly: true, style: { color: '#888', fontSize: 12 } })] })] }), _jsx("p", { className: "step-hint", children: "Confirmations: 15 for Ethereum, 1 for Arbitrum/Optimism/Base. Executor is chain-specific and pre-filled from the LZ metadata API." }), _jsxs("div", { className: "step-actions", style: { alignItems: 'start', marginTop: 12 }, children: [_jsxs("div", { children: [_jsxs("div", { className: "label", style: { marginBottom: 6 }, children: ["DVNs \u2014 ", homeChain.name, " (send config)"] }), _jsx(DVNDropdown, { chainKey: homeChain.chainKey, selected: selectedHome, onToggle: toggleHome }), _jsxs("div", { style: { marginTop: 10 }, children: [_jsx(Field, { label: "Send lib (from step 3)", value: sendLib, onChange: setSendLib, placeholder: homeChain.sendLib ?? verifyResult?.homeSendLib ?? '0x…' }), _jsx(ChainSwitch, { label: "Requires:", requiredChainId: homeChain.chainId, requiredChainName: homeChain.name, connectedChainId: connectedChainId, isConnected: isConnected, onSwitch: () => onSwitchNetwork(homeChain.chainId) }), _jsx("button", { className: "btn btn-primary", disabled: !isConnected || connectedChainId !== homeChain.chainId || selectedHome.size === 0 || !(sendLib || homeChain.sendLib || verifyResult?.homeSendLib), onClick: async () => {
                                            setSendTx({ status: 'pending' });
                                            const lib = (sendLib || homeChain.sendLib || verifyResult?.homeSendLib) ?? '';
                                            const dvns = [...selectedHome.values()].map((p) => p.address);
                                            const exec = homeChain.executor;
                                            setSendTx(await epConfig.setULNConfig(homeChain.endpoint, adapterAddr, lib, remoteChain.eid, { confirmations: Number(confirmations), requiredDVNs: dvns }, exec ? { maxMessageSize: 10000, executor: exec } : undefined));
                                        }, children: "Set Send Config" }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TxStatus, { state: sendTx }) })] })] }), isRemoteEvm && (_jsxs("div", { children: [_jsxs("div", { className: "label", style: { marginBottom: 6 }, children: ["DVNs \u2014 ", remoteChain.name, " (receive config)"] }), _jsx(DVNDropdown, { chainKey: remoteChain.chainKey, selected: selectedRemote, onToggle: toggleRemote }), _jsxs("div", { style: { marginTop: 10 }, children: [_jsx(Field, { label: "Receive lib (from step 3)", value: recvLib, onChange: setRecvLib, placeholder: remoteChain.receiveLib ?? verifyResult?.remoteReceiveLib ?? '0x…' }), _jsx(ChainSwitch, { label: "Requires:", requiredChainId: remoteChain.chainId, requiredChainName: remoteChain.name, connectedChainId: connectedChainId, isConnected: isConnected, onSwitch: () => onSwitchNetwork(remoteChain.chainId) }), _jsx("button", { className: "btn btn-primary", disabled: !isConnected || connectedChainId !== remoteChain.chainId || selectedRemote.size === 0 || !(recvLib || remoteChain.receiveLib || verifyResult?.remoteReceiveLib), onClick: async () => {
                                            setRecvTx({ status: 'pending' });
                                            const lib = (recvLib || remoteChain.receiveLib || verifyResult?.remoteReceiveLib) ?? '';
                                            const dvns = [...selectedRemote.values()].map((p) => p.address);
                                            setRecvTx(await epConfig.setULNConfig(remoteChain.endpoint, peerAddr, lib, homeChain.eid, { confirmations: Number(confirmations), requiredDVNs: dvns }));
                                        }, children: "Set Receive Config" }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TxStatus, { state: recvTx }) })] })] }))] })] }));
}
function DVNChip({ name, addr, color }) {
    return (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }, children: [_jsx("span", { style: { width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 } }), _jsx("span", { style: { fontSize: 12 }, children: name }), _jsxs("span", { style: { fontSize: 10, color: '#555' }, children: [addr.slice(0, 8), "\u2026"] })] }));
}
// ── Step 5 — Set Peers ────────────────────────────────────────────────────────
function Step5Peers({ open, onToggle, homeChain, remoteChain, adapterAddr, peerAddr, connectedChainId, isConnected, onSwitchNetwork, wiring, verifyResult, isRemoteEvm = true }) {
    const [confirmed, setConfirmed] = useState(false);
    const [adapterTx, setAdapterTx] = useState({ status: 'idle' });
    const [peerTx, setPeerTx] = useState({ status: 'idle' });
    const homePeerOk = verifyResult?.checks.find((c) => c.label === 'Peer set (home → remote)')?.passed;
    const remotePeerOk = verifyResult?.checks.find((c) => c.label === 'Peer set (remote → home)')?.passed;
    const badge = verifyResult
        ? _jsx("span", { style: { fontSize: 11, color: homePeerOk && remotePeerOk ? '#6bcb77' : '#ff6b6b' }, children: homePeerOk && remotePeerOk ? '✓' : '✗' })
        : null;
    return (_jsxs(StepCard, { n: 5, title: "Set Peers", statusBadge: badge, open: open, onToggle: onToggle, subtitle: "Register counterparty addresses. Opens the bridge \u2014 do this LAST.", children: [_jsx("div", { className: "step-warn-banner", children: "\u26A0 Setting peers opens the messaging channel. Tokens can flow immediately after. Ensure steps 1\u20134 are complete and verified before proceeding." }), _jsxs("div", { style: { fontSize: 13, marginTop: 12 }, children: [_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("span", { className: "label", children: "Adapter \u2192 Peer" }), _jsx("div", { className: "mono-block", children: peerAddr || '(enter peer address above)' })] }), _jsxs("div", { children: [_jsx("span", { className: "label", children: "Peer \u2192 Adapter" }), _jsx("div", { className: "mono-block", children: adapterAddr || '(enter adapter address above)' })] })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0', fontSize: 13, cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: confirmed, onChange: (e) => setConfirmed(e.target.checked) }), "I confirm steps 1\u20134 are complete and the addresses are correct."] }), _jsxs("div", { className: "step-actions", children: [_jsxs("div", { children: [_jsx(ChainSwitch, { label: "Adapter (home):", requiredChainId: homeChain.chainId, requiredChainName: homeChain.name, connectedChainId: connectedChainId, isConnected: isConnected, onSwitch: () => onSwitchNetwork(homeChain.chainId) }), _jsx("button", { className: "btn btn-primary", disabled: !confirmed || !isConnected || connectedChainId !== homeChain.chainId, onClick: async () => { setAdapterTx({ status: 'pending' }); setAdapterTx(await wiring.setEvmPeer(adapterAddr, remoteChain.eid, peerAddr)); }, children: "Set Peer on Adapter" }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TxStatus, { state: adapterTx }) })] }), isRemoteEvm && (_jsxs("div", { children: [_jsx(ChainSwitch, { label: "Peer (remote):", requiredChainId: remoteChain.chainId, requiredChainName: remoteChain.name, connectedChainId: connectedChainId, isConnected: isConnected, onSwitch: () => onSwitchNetwork(remoteChain.chainId) }), _jsx("button", { className: "btn btn-primary", disabled: !confirmed || !isConnected || connectedChainId !== remoteChain.chainId, onClick: async () => { setPeerTx({ status: 'pending' }); setPeerTx(await wiring.setEvmPeer(peerAddr, homeChain.eid, adapterAddr)); }, children: "Set Peer on Peer contract" }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TxStatus, { state: peerTx }) })] })), !isRemoteEvm && (_jsx("div", { style: { fontSize: 12, color: '#888', padding: '8px 0' }, children: "Starknet peer is set in step 6 below." }))] })] }));
}
