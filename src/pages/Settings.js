import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import packageJson from '../../package.json';
const STORAGE_KEY = 'ozlz_rpc_overrides';
function loadOverrides() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw)
            return JSON.parse(raw);
    }
    catch { /* ignore */ }
    return { starknetMainnet: '', starknetSepolia: '' };
}
function saveOverrides(overrides) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}
export function getStarknetMainnetRpc(defaultRpc) {
    const o = loadOverrides();
    return o.starknetMainnet.trim() || defaultRpc;
}
export function getStarknetSepoliaRpc(defaultRpc) {
    const o = loadOverrides();
    return o.starknetSepolia.trim() || defaultRpc;
}
function SettingRow({ label, hint, value, onChange, placeholder }) {
    return (_jsxs("div", { className: "mb-5", children: [_jsx("label", { className: "block font-headline text-sm font-semibold text-on-surface mb-0.5", children: label }), _jsx("p", { className: "text-xs text-on-surface-variant mb-2", children: hint }), _jsx("input", { className: "input w-full max-w-lg font-mono text-[12px]", value: value, onChange: (e) => onChange(e.target.value), placeholder: placeholder, spellCheck: false })] }));
}
function SectionCard({ title, children }) {
    return (_jsxs("div", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6 mb-5", children: [_jsx("h3", { className: "font-headline text-base font-bold text-on-surface mb-4", children: title }), children] }));
}
export function Settings() {
    const [overrides, setOverrides] = useState(loadOverrides);
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        if (!saved)
            return;
        const t = setTimeout(() => setSaved(false), 2000);
        return () => clearTimeout(t);
    }, [saved]);
    function update(key, value) {
        setOverrides((prev) => ({ ...prev, [key]: value }));
        setSaved(false);
    }
    function handleSave() {
        saveOverrides(overrides);
        setSaved(true);
    }
    function handleReset() {
        const empty = { starknetMainnet: '', starknetSepolia: '' };
        setOverrides(empty);
        saveOverrides(empty);
        setSaved(false);
    }
    return (_jsxs("div", { className: "max-w-2xl", children: [_jsxs(SectionCard, { title: "Starknet RPC Endpoints", children: [_jsx("p", { className: "text-xs text-on-surface-variant mb-4", children: "Override the default public RPC endpoints. Leave blank to use the defaults. Changes take effect on next page load." }), _jsx(SettingRow, { label: "Starknet Mainnet", hint: "Default: https://rpc.starknet.lava.build (fallback: https://starknet.drpc.org)", value: overrides.starknetMainnet, onChange: (v) => update('starknetMainnet', v), placeholder: "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY" }), _jsx(SettingRow, { label: "Starknet Sepolia", hint: "Default: https://starknet-sepolia.drpc.org", value: overrides.starknetSepolia, onChange: (v) => update('starknetSepolia', v), placeholder: "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY" }), _jsxs("div", { className: "flex gap-3 items-center mt-2", children: [_jsx("button", { className: "btn btn-primary", onClick: handleSave, children: "Save" }), _jsx("button", { className: "btn", onClick: handleReset, children: "Reset to defaults" }), saved && _jsx("span", { className: "text-xs text-secondary", children: "Saved \u2014 reload to apply" })] })] }), _jsx(SectionCard, { title: "Current Configuration", children: _jsxs("div", { className: "text-xs font-mono space-y-1.5 text-on-surface-variant", children: [_jsxs("div", { className: "flex gap-2", children: [_jsx("span", { className: "text-outline-variant w-40 flex-shrink-0", children: "Version" }), _jsxs("span", { className: "text-on-surface", children: ["v", packageJson.version] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("span", { className: "text-outline-variant w-40 flex-shrink-0", children: "Starknet mainnet" }), _jsx("span", { className: "text-on-surface break-all", children: overrides.starknetMainnet || 'https://rpc.starknet.lava.build (default)' })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("span", { className: "text-outline-variant w-40 flex-shrink-0", children: "Starknet sepolia" }), _jsx("span", { className: "text-on-surface break-all", children: overrides.starknetSepolia || 'https://starknet-sepolia.drpc.org (default)' })] })] }) })] }));
}
