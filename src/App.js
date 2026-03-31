import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import packageJson from '../package.json';
import { OFTWiring } from '@/pages/OFTWiring';
import { Timelock } from '@/pages/Timelock';
import { Settings } from '@/pages/Settings';
import { WalletProvider, useWallet } from '@/context/WalletContext';
function Sidebar() {
    return (_jsx("aside", { className: "fixed left-0 top-0 flex flex-col h-screen w-64 flex-shrink-0 bg-[#060e20] border-r border-outline-variant/15 z-50", children: _jsxs("div", { className: "flex flex-col h-full py-6 px-4", children: [_jsxs("div", { className: "mb-8 px-2", children: [_jsx("div", { className: "text-lg font-bold tracking-tighter text-primary font-headline", children: "OZLZ - Configurator" }), _jsx("div", { className: "text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5 font-headline opacity-60", children: "Technical Engine" })] }), _jsxs("nav", { className: "flex-1 space-y-1 font-headline text-sm tracking-tight", children: [_jsx("div", { className: "pt-2 pb-2 px-2", children: _jsx("span", { className: "text-[10px] uppercase tracking-[0.2em] text-outline-variant font-bold", children: "OpenZeppelin" }) }), _jsxs(NavLink, { to: "/", end: true, className: ({ isActive }) => isActive
                                ? 'flex items-center gap-3 px-4 py-2 rounded bg-surface-container-highest text-primary font-bold border-r-2 border-primary'
                                : 'flex items-center gap-3 px-4 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors', children: [_jsx("span", { className: "material-symbols-outlined text-lg", children: "security" }), "TimeLock"] }), _jsx("div", { className: "pt-4 pb-2 px-2", children: _jsx("span", { className: "text-[10px] uppercase tracking-[0.2em] text-outline-variant font-bold", children: "LayerZero" }) }), _jsxs(NavLink, { to: "/wiring", className: ({ isActive }) => isActive
                                ? 'flex items-center gap-3 px-4 py-2 rounded bg-surface-container-highest text-primary font-bold border-r-2 border-primary'
                                : 'flex items-center gap-3 px-4 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors', children: [_jsx("span", { className: "material-symbols-outlined text-lg", children: "layers" }), "OFT Config"] }), _jsx("div", { className: "mt-8 border-t border-outline-variant/10 pt-4", children: _jsxs(NavLink, { to: "/settings", className: ({ isActive }) => isActive
                                    ? 'flex items-center gap-3 px-4 py-2 rounded bg-surface-container-highest text-primary font-bold border-r-2 border-primary'
                                    : 'flex items-center gap-3 px-4 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors', children: [_jsx("span", { className: "material-symbols-outlined text-lg", children: "settings" }), "Settings"] }) })] })] }) }));
}
function HeaderWallets() {
    const { evm, stark } = useWallet();
    const loc = useLocation();
    const isWiring = loc.pathname === '/wiring';
    return (_jsxs("div", { className: "flex items-center gap-2", children: [evm.address ? (_jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded border border-outline-variant/20", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-secondary" }), _jsxs("span", { className: "font-mono text-[11px] text-on-surface", children: [evm.address.slice(0, 6), "\u2026", evm.address.slice(-4)] })] })) : (_jsx("button", { onClick: () => evm.connect().catch(() => { }), className: "px-4 py-1.5 bg-gradient-to-br from-primary to-primary-container text-on-primary-container font-headline text-xs font-bold uppercase tracking-wider rounded shadow-lg shadow-primary/10 hover:opacity-90 transition-all active:scale-[0.99]", children: "Connect EVM" })), isWiring && (stark.address ? (_jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded border border-tertiary/20", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-tertiary" }), _jsxs("span", { className: "font-mono text-[11px] text-tertiary", children: [stark.address.slice(0, 8), "\u2026", stark.address.slice(-4)] }), _jsx("button", { onClick: () => stark.disconnect().catch(() => { }), className: "text-on-surface-variant hover:text-error transition-colors ml-1 text-xs", children: "\u2715" })] })) : (_jsx("button", { onClick: () => stark.connect().catch(() => { }), className: "px-4 py-1.5 bg-surface-container border border-tertiary/30 text-tertiary font-headline text-xs font-bold uppercase tracking-wider rounded hover:bg-tertiary/5 transition-all", children: "Connect Starknet" })))] }));
}
function PageTitle() {
    const loc = useLocation();
    if (loc.pathname === '/wiring')
        return _jsxs(_Fragment, { children: [_jsx("span", { className: "text-on-surface-variant font-normal", children: "LayerZero /" }), " ", _jsx("span", { className: "text-primary", children: "OFT Config" })] });
    if (loc.pathname === '/settings')
        return _jsxs(_Fragment, { children: [_jsx("span", { className: "text-on-surface-variant font-normal", children: "System /" }), " ", _jsx("span", { className: "text-primary", children: "Settings" })] });
    return _jsxs(_Fragment, { children: [_jsx("span", { className: "text-on-surface-variant font-normal", children: "OpenZeppelin /" }), " ", _jsx("span", { className: "text-primary", children: "TimeLock" })] });
}
function TopBar() {
    return (_jsxs("header", { className: "fixed top-0 right-0 left-64 h-16 flex items-center justify-between px-8 z-40 bg-[#091328]/80 backdrop-blur-xl border-b border-outline-variant/15", children: [_jsx("h1", { className: "font-headline text-base font-bold tracking-tight text-on-surface", children: _jsx(PageTitle, {}) }), _jsx(HeaderWallets, {})] }));
}
function Footer() {
    return (_jsx("footer", { className: "fixed bottom-0 right-0 left-64 px-8 flex items-center gap-4 border-t border-outline-variant/10 h-10 bg-[#060e20] z-50", children: _jsxs("span", { className: "font-mono text-[10px] uppercase tracking-widest text-outline-variant", children: ["v", packageJson.version] }) }));
}
function AppShell() {
    return (_jsxs("div", { className: "bg-surface text-on-surface font-body min-h-screen", children: [_jsx(Sidebar, {}), _jsx(TopBar, {}), _jsx("main", { className: "ml-64 mt-16 pb-12 min-h-screen", children: _jsx("div", { className: "p-8", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Timelock, {}) }), _jsx(Route, { path: "/wiring", element: _jsx(OFTWiring, {}) }), _jsx(Route, { path: "/settings", element: _jsx(Settings, {}) })] }) }) }), _jsx(Footer, {})] }));
}
export function App() {
    return (_jsx(BrowserRouter, { children: _jsx(WalletProvider, { children: _jsx(AppShell, {}) }) }));
}
