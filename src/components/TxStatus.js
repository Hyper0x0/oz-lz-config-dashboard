import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function TxStatus({ state }) {
    if (state.status === 'idle')
        return null;
    const styles = {
        pending: { background: '#1a1a2e', border: '1px solid #4a4a8a', color: '#a0a0ff' },
        success: { background: '#0a1f0a', border: '1px solid #2a6a2a', color: '#7fff7f' },
        error: { background: '#1f0a0a', border: '1px solid #6a2a2a', color: '#ff7f7f' },
    };
    const style = styles[state.status] ?? styles['pending'];
    return (_jsxs("div", { style: { ...style, padding: '10px 14px', borderRadius: 6, marginTop: 10, fontSize: 13, fontFamily: 'monospace' }, children: [state.status === 'pending' && '⏳ Transaction pending…', state.status === 'success' && (_jsxs("span", { children: ["\u2705 Success \u2014", ' ', _jsx("span", { style: { wordBreak: 'break-all' }, children: state.hash })] })), state.status === 'error' && `❌ ${state.message}`] }));
}
