import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { OFTWiring } from '@/pages/OFTWiring';
import { Timelock } from '@/pages/Timelock';
export function App() {
    return (_jsxs(BrowserRouter, { children: [_jsxs("nav", { className: "nav", children: [_jsx("span", { className: "nav-brand", children: "OZLZ - Config Dashboard" }), _jsxs("div", { className: "nav-links", children: [_jsx(NavLink, { to: "/", className: ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link'), children: "OZ - Timelock" }), _jsx(NavLink, { to: "/wiring", className: ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link'), children: "LZ - OFT" })] })] }), _jsx("main", { className: "main", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Timelock, {}) }), _jsx(Route, { path: "/wiring", element: _jsx(OFTWiring, {}) })] }) })] }));
}
