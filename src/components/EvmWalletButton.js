import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function EvmWalletButton({ address, chainId, chainName, onConnect, onSwitchNetwork, targetChainId, }) {
    const isWrongChain = targetChainId !== undefined && chainId !== null && chainId !== targetChainId;
    if (!address) {
        return (_jsx("button", { className: "btn", onClick: onConnect, children: "Connect MetaMask" }));
    }
    return (_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsxs("span", { className: "badge", children: [chainName ?? `chainId:${chainId}`, " \u2014 ", address.slice(0, 6), "\u2026", address.slice(-4)] }), isWrongChain && onSwitchNetwork && (_jsxs("button", { className: "btn btn-warn", onClick: onSwitchNetwork, children: ["Switch to ", chainName] }))] }));
}
