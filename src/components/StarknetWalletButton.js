import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function StarknetWalletButton({ address, onConnect, onDisconnect }) {
    if (!address) {
        return (_jsx("button", { className: "btn btn-stark", onClick: onConnect, children: "Connect Starknet" }));
    }
    return (_jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center', padding: '4px 10px', background: '#1a0e0a', border: '1px solid #3a2010', borderRadius: 6, fontSize: 12 }, children: [_jsx("span", { style: { color: '#ff7e33' }, children: "Starknet" }), _jsxs("span", { style: { fontFamily: 'monospace', color: '#aaa' }, children: [address.slice(0, 8), "\u2026", address.slice(-4)] }), _jsx("button", { className: "btn", style: { fontSize: 11, padding: '1px 6px' }, onClick: onDisconnect, children: "\u2715" })] }));
}
