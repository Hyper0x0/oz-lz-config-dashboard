import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useMemo, useEffect } from 'react';
import { JsonRpcProvider, Interface, FunctionFragment } from 'ethers';
import TimelockControllerABI from '@/abis/evm/TimelockController.json';
import timelockTarget from '@/config/timelockTarget.json';
import { useWallet } from '@/context/WalletContext';
import { useTimelockOps } from '@/hooks/useTimelockOps';
import { TxStatus } from '@/components/TxStatus';
import { CONTRACTS, ARB_SEPOLIA, ARBISCAN_API_KEY } from '@/config/chains';
import { hashOperation as localHashOp, formatDelay, randomSalt, formatCountdown } from '@/utils/timelock';
// ── Parse timelockTarget.json once ───────────────────────────────────────────
const TARGET_IFACE = new Interface(timelockTarget.abi);
const WRITE_FUNCTIONS = TARGET_IFACE.fragments.filter((f) => FunctionFragment.isFragment(f) &&
    f.stateMutability !== 'view' &&
    f.stateMutability !== 'pure');
function parseArg(value, type) {
    if (type === 'bool')
        return value === 'true' || value === '1';
    if (type.startsWith('uint') || type.startsWith('int'))
        return BigInt(value || '0');
    return value; // address, bytes*, string
}
function StateBadge({ state }) {
    if (state === 'Ready')
        return _jsx("span", { className: "inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-secondary/10 text-secondary border border-secondary/20", children: "Ready" });
    if (state === 'Waiting')
        return _jsx("span", { className: "inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-tertiary/10 text-tertiary border border-tertiary/20", children: "Waiting" });
    if (state === 'Done')
        return _jsx("span", { className: "inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-outline-variant/20 text-on-surface-variant", children: "Done" });
    return _jsx("span", { className: "inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-error/10 text-error border border-error/20", children: "Unset" });
}
export function Timelock() {
    const { evm } = useWallet();
    const ops = useTimelockOps(evm.signer);
    const [timelockAddr, setTimelockAddr] = useState(CONTRACTS.adminGateway ?? '');
    const [minDelay, setMinDelay] = useState('');
    // ── Dynamic function picker ───────────────────────────────────────────────
    const [selectedFn, setSelectedFn] = useState(WRITE_FUNCTIONS[0]?.name ?? '');
    const [fnArgs, setFnArgs] = useState(() => WRITE_FUNCTIONS[0] ? WRITE_FUNCTIONS[0].inputs.map(() => '') : []);
    const currentFn = WRITE_FUNCTIONS.find((f) => f.name === selectedFn) ?? null;
    useEffect(() => {
        setFnArgs(currentFn ? currentFn.inputs.map(() => '') : []);
    }, [selectedFn]); // eslint-disable-line react-hooks/exhaustive-deps
    function setArg(i, value) {
        setFnArgs((prev) => { const next = [...prev]; next[i] = value; return next; });
    }
    // ── Calldata encoding ─────────────────────────────────────────────────────
    const { calldata, calldataError } = useMemo(() => {
        if (!currentFn)
            return { calldata: null, calldataError: 'No function selected' };
        if (fnArgs.some((v) => v === '' && currentFn.inputs[fnArgs.indexOf(v)]?.type !== 'string'))
            return { calldata: null, calldataError: null }; // not ready yet, no error shown
        try {
            const parsed = fnArgs.map((v, i) => parseArg(v, currentFn.inputs[i].type));
            const data = TARGET_IFACE.encodeFunctionData(currentFn.name, parsed);
            return { calldata: data, calldataError: null };
        }
        catch (e) {
            return { calldata: null, calldataError: e instanceof Error ? e.message : String(e) };
        }
    }, [currentFn, fnArgs]);
    // ── Timelock params ───────────────────────────────────────────────────────
    const [delay, setDelay] = useState('172800');
    const [salt, setSalt] = useState(randomSalt());
    const [predecessor, setPredecessor] = useState('0x0000000000000000000000000000000000000000000000000000000000000000');
    const [lastCalldata, setLastCalldata] = useState(null);
    useEffect(() => { if (calldata)
        setLastCalldata(calldata); }, [calldata]);
    const execCalldata = calldata ?? lastCalldata;
    const freshOpHash = execCalldata && timelockAddr
        ? localHashOp(timelockAddr, 0n, execCalldata, predecessor, salt)
        : null;
    const [lastOpHash, setLastOpHash] = useState(null);
    useEffect(() => { if (freshOpHash)
        setLastOpHash(freshOpHash); }, [freshOpHash]);
    const opHash = freshOpHash ?? lastOpHash;
    // ── Check op state ────────────────────────────────────────────────────────
    const [lookupHash, setLookupHash] = useState('');
    const [opState, setOpState] = useState(null);
    const [opEta, setOpEta] = useState(null);
    const [lookupDebug, setLookupDebug] = useState(null);
    const [lookupError, setLookupError] = useState(null);
    const [deriveTxHash, setDeriveTxHash] = useState('');
    const [deriving, setDeriving] = useState(false);
    const [deriveError, setDeriveError] = useState(null);
    const [derivedTarget, setDerivedTarget] = useState(null);
    const [derivedCalldata, setDerivedCalldata] = useState(null);
    const [derivedPredecessor, setDerivedPredecessor] = useState(null);
    const [derivedSalt, setDerivedSalt] = useState(null);
    const [scheduleTx, setScheduleTx] = useState({ status: 'idle' });
    const [executeTx, setExecuteTx] = useState({ status: 'idle' });
    const [cancelTx, setCancelTx] = useState({ status: 'idle' });
    const [scannedOps, setScannedOps] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState(null);
    const [scanFromBlock, setScanFromBlock] = useState('');
    // ── Handlers ──────────────────────────────────────────────────────────────
    async function loadMinDelay() {
        if (!timelockAddr)
            return;
        const d = await ops.getMinDelay(timelockAddr, evm.provider ?? undefined);
        setMinDelay(formatDelay(Number(d)));
        setDelay(String(d));
    }
    async function handleSchedule() {
        if (!timelockAddr || !calldata)
            return;
        setScheduleTx({ status: 'pending' });
        const result = await ops.schedule(timelockAddr, 0n, calldata, predecessor, salt, BigInt(delay));
        setScheduleTx(result);
    }
    async function handleLookup() {
        if (!timelockAddr || !lookupHash)
            return;
        setOpState(null);
        setOpEta(null);
        setLookupDebug(null);
        setLookupError(null);
        try {
            const wp = evm.provider ?? undefined;
            const ts = await ops.getTimestamp(timelockAddr, lookupHash, wp);
            const tsNum = Number(ts);
            const now = Math.floor(Date.now() / 1000);
            const network = wp ? await wp.getNetwork() : null;
            setLookupDebug(`contract: ${timelockAddr} | hash: ${lookupHash.slice(0, 14)}… | timestamp: ${tsNum} | chain: ${network?.chainId ?? 'public RPC'}`);
            let state;
            if (tsNum === 0)
                state = 'Unset';
            else if (tsNum === 1)
                state = 'Done';
            else if (tsNum <= now)
                state = 'Ready';
            else
                state = 'Waiting';
            setOpState(state);
            if (state === 'Waiting')
                setOpEta(formatCountdown(tsNum));
        }
        catch (e) {
            setLookupError(e instanceof Error ? e.message : String(e));
        }
    }
    async function handleExecute() {
        const target = derivedTarget ?? timelockAddr;
        const data = derivedCalldata ?? execCalldata;
        const pred = derivedPredecessor ?? predecessor;
        const s = derivedSalt ?? salt;
        if (!target || !data)
            return;
        setExecuteTx({ status: 'pending' });
        const result = await ops.execute(target, 0n, data, pred, s);
        setExecuteTx(result);
    }
    async function handleDeriveFromTx() {
        if (!deriveTxHash)
            return;
        setDeriving(true);
        setDeriveError(null);
        try {
            const provider = evm.provider ?? new JsonRpcProvider(ARB_SEPOLIA.rpc);
            const receipt = await provider.getTransactionReceipt(deriveTxHash);
            if (!receipt) {
                setDeriveError('Transaction not found');
                return;
            }
            const iface = new Interface(TimelockControllerABI);
            const eventTopic = iface.getEvent('CallScheduled').topicHash;
            const log = receipt.logs.find((l) => l.topics[0] === eventTopic);
            if (!log) {
                setDeriveError('No CallScheduled event found in this transaction');
                return;
            }
            const id = log.topics[1];
            const decoded = iface.decodeEventLog('CallScheduled', log.data, log.topics);
            setLookupHash(id);
            setDerivedTarget(decoded.target);
            setDerivedCalldata(decoded.data);
            setDerivedPredecessor(decoded.predecessor);
            const saltTopic = iface.getEvent('CallSalt').topicHash;
            const saltLog = receipt.logs.find((l) => l.topics[0] === saltTopic && l.topics[1] === id);
            setDerivedSalt(saltLog
                ? iface.decodeEventLog('CallSalt', saltLog.data, saltLog.topics).salt
                : '0x0000000000000000000000000000000000000000000000000000000000000000');
        }
        catch (e) {
            setDeriveError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setDeriving(false);
        }
    }
    async function handleCancel() {
        if (!timelockAddr || !lookupHash)
            return;
        setCancelTx({ status: 'pending' });
        setCancelTx(await ops.cancel(timelockAddr, lookupHash));
    }
    async function handleScan() {
        if (!timelockAddr)
            return;
        setScanning(true);
        setScanError(null);
        setScannedOps([]);
        try {
            const iface = new Interface(TimelockControllerABI);
            const scheduledTopic = iface.getEvent('CallScheduled').topicHash;
            const executedTopic = iface.getEvent('CallExecuted').topicHash;
            const cancelledTopic = iface.getEvent('Cancelled').topicHash;
            const saltTopic = iface.getEvent('CallSalt').topicHash;
            const fromBlock = scanFromBlock.trim() || '0';
            const base = `https://api.etherscan.io/v2/api?chainid=${ARB_SEPOLIA.id}&module=logs&action=getLogs&address=${timelockAddr}&fromBlock=${fromBlock}&toBlock=latest&apikey=${ARBISCAN_API_KEY}`;
            async function fetchLogs(topic0) {
                const res = await fetch(`${base}&topic0=${topic0}`);
                const json = await res.json();
                if (!Array.isArray(json.result)) {
                    const detail = typeof json.result === 'string' ? json.result : (json.message ?? 'unknown error');
                    if (detail === 'No records found')
                        return [];
                    throw new Error(`Arbiscan: ${detail}`);
                }
                return json.result;
            }
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const scheduledLogs = await fetchLogs(scheduledTopic);
            await wait(400);
            const executedLogs = await fetchLogs(executedTopic);
            await wait(400);
            const cancelledLogs = await fetchLogs(cancelledTopic);
            await wait(400);
            const saltLogs = await fetchLogs(saltTopic);
            const doneIds = new Set();
            for (const log of executedLogs)
                doneIds.add(log.topics[1]);
            for (const log of cancelledLogs)
                doneIds.add(log.topics[1]);
            const saltMap = new Map();
            for (const log of saltLogs) {
                const d = iface.decodeEventLog('CallSalt', log.data, log.topics);
                saltMap.set(log.topics[1], d.salt);
            }
            const seen = new Set();
            const active = [];
            for (const log of scheduledLogs) {
                const id = log.topics[1];
                const index = parseInt(log.topics[2], 16);
                if (index !== 0 || seen.has(id) || doneIds.has(id))
                    continue;
                seen.add(id);
                const decoded = iface.decodeEventLog('CallScheduled', log.data, log.topics);
                active.push({ id, target: decoded.target, data: decoded.data, predecessor: decoded.predecessor,
                    salt: saltMap.get(id) ?? '0x0000000000000000000000000000000000000000000000000000000000000000', txHash: log.transactionHash });
            }
            const now = Math.floor(Date.now() / 1000);
            const wp = evm.provider ?? undefined;
            const results = await Promise.all(active.map(async (op) => {
                const ts = await ops.getTimestamp(timelockAddr, op.id, wp);
                const tsNum = Number(ts);
                let state;
                if (tsNum === 0)
                    state = 'Unset';
                else if (tsNum === 1)
                    state = 'Done';
                else if (tsNum <= now)
                    state = 'Ready';
                else
                    state = 'Waiting';
                return { ...op, state, eta: state === 'Waiting' ? formatCountdown(tsNum) : null };
            }));
            setScannedOps(results.filter((r) => r.state === 'Waiting' || r.state === 'Ready'));
        }
        catch (e) {
            setScanError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setScanning(false);
        }
    }
    const arbiscanTx = (hash) => `https://sepolia.arbiscan.io/tx/${hash}`;
    // ── Render ────────────────────────────────────────────────────────────────
    return (_jsxs("div", { className: "grid grid-cols-12 gap-6", children: [_jsxs("div", { className: "col-span-12 lg:col-span-8 space-y-6", children: [_jsxs("section", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6", children: [_jsxs("div", { className: "flex items-center gap-3 mb-6", children: [_jsx("div", { className: "w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center", children: _jsx("span", { className: "material-symbols-outlined text-primary text-lg", children: "schedule" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-headline text-base font-bold text-on-surface", children: "TimelockController" }), _jsx("p", { className: "text-[11px] text-on-surface-variant", children: "Contract address and configuration" })] })] }), _jsxs("div", { className: "flex gap-3 items-end", children: [_jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: "TimelockController address" }), _jsx("input", { className: "input", value: timelockAddr, onChange: (e) => setTimelockAddr(e.target.value) })] }), _jsx("button", { className: "btn", onClick: loadMinDelay, children: "Load Min Delay" })] }), minDelay && (_jsxs("div", { className: "mt-3 text-sm text-on-surface-variant", children: ["Min delay: ", _jsx("strong", { className: "text-on-surface", children: minDelay })] }))] }), _jsxs("section", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6", children: [_jsxs("div", { className: "flex items-center gap-3 mb-6", children: [_jsx("div", { className: "w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center", children: _jsx("span", { className: "material-symbols-outlined text-primary text-lg", children: "add_circle" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-headline text-base font-bold text-on-surface", children: "Schedule Operation" }), _jsx("p", { className: "text-[11px] text-on-surface-variant", children: "Encode and schedule a timelock operation" })] })] }), WRITE_FUNCTIONS.length === 0 ? (_jsxs("div", { className: "text-xs text-on-surface-variant bg-surface-container rounded-lg p-4 border border-outline-variant/10", children: ["No write functions found in ", _jsx("span", { className: "font-mono", children: "src/config/timelockTarget.json" }), ". Replace the ABI with your contract's ABI."] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "mb-4", children: [_jsx("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: "Function" }), _jsx("select", { className: "input", value: selectedFn, onChange: (e) => setSelectedFn(e.target.value), children: WRITE_FUNCTIONS.map((f) => (_jsx("option", { value: f.name, children: f.name }, f.name))) })] }), currentFn && currentFn.inputs.length > 0 && (_jsx("div", { className: "mb-4 space-y-3", children: currentFn.inputs.map((input, i) => (_jsxs("div", { children: [_jsxs("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: [input.name || `arg${i}`, _jsxs("span", { className: "ml-1.5 normal-case text-primary/60 font-normal", children: ["(", input.type, ")"] })] }), _jsx("input", { className: "input", value: fnArgs[i] ?? '', onChange: (e) => setArg(i, e.target.value), spellCheck: false, placeholder: input.type === 'address' ? '0x…' : input.type.startsWith('uint') ? '0' : '' })] }, i))) })), currentFn && currentFn.inputs.length === 0 && (_jsx("div", { className: "mb-4 text-xs text-on-surface-variant", children: "No inputs \u2014 this function takes no arguments." }))] })), _jsxs("div", { className: "flex gap-3 mt-4 flex-wrap", children: [_jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: "Delay (seconds)" }), _jsx("input", { className: "input", value: delay, onChange: (e) => setDelay(e.target.value) })] }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: "Salt" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { className: "input flex-1", value: salt, onChange: (e) => setSalt(e.target.value) }), _jsx("button", { className: "btn", onClick: () => setSalt(randomSalt()), children: "Rand" })] })] }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: "Predecessor" }), _jsx("input", { className: "input", value: predecessor, onChange: (e) => setPredecessor(e.target.value) })] })] }), _jsxs("div", { className: "mt-4", children: [calldataError && (_jsx("div", { className: "text-xs text-error mb-3", children: calldataError })), calldata && (_jsxs("div", { className: "mb-3", children: [_jsx("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: "Encoded calldata" }), _jsx("div", { className: "font-mono text-[11px] text-on-surface-variant break-all", children: calldata })] })), opHash && (_jsxs("div", { className: "bg-surface-container rounded-lg p-4 border border-primary/10", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant", children: "Operation hash" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { className: "btn text-[11px] py-0.5 px-2", onClick: () => navigator.clipboard.writeText(opHash), children: "Copy" }), _jsx("button", { className: "btn text-[11px] py-0.5 px-2", onClick: () => setLookupHash(opHash), children: "Use for lookup" })] })] }), _jsx("div", { className: "font-mono text-xs text-primary break-all", children: opHash }), _jsx("div", { className: "text-[11px] text-on-surface-variant mt-2 opacity-60", children: "Updates live as you change params \u2014 matches on-chain hashOperation()" })] }))] }), _jsx("div", { className: "mt-4", children: _jsx("button", { className: "btn btn-primary", onClick: handleSchedule, disabled: !evm.isConnected || !calldata, children: "Schedule" }) }), _jsx("div", { className: "mt-3", children: _jsx(TxStatus, { state: scheduleTx }) })] }), _jsxs("section", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6", children: [_jsxs("div", { className: "flex items-center gap-3 mb-6", children: [_jsx("div", { className: "w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center", children: _jsx("span", { className: "material-symbols-outlined text-primary text-lg", children: "search" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-headline text-base font-bold text-on-surface", children: "Check Operation State" }), _jsx("p", { className: "text-[11px] text-on-surface-variant", children: "Lookup operation status by hash" })] })] }), _jsxs("div", { className: "bg-surface-container rounded-lg p-4 mb-5", children: [_jsx("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-2", children: "Derive hash from schedule tx hash" }), _jsxs("div", { className: "flex gap-2 items-end", children: [_jsx("input", { className: "input flex-1", placeholder: "0x\u2026 (transaction hash of the schedule call)", value: deriveTxHash, onChange: (e) => setDeriveTxHash(e.target.value) }), _jsx("button", { className: "btn", onClick: handleDeriveFromTx, disabled: deriving || !deriveTxHash, children: deriving ? 'Fetching…' : 'Derive' })] }), deriveError && _jsx("div", { className: "text-xs text-error mt-2", children: deriveError }), _jsx("div", { className: "text-[11px] text-on-surface-variant mt-2 opacity-60", children: "Reads the CallScheduled event from the tx receipt and extracts the operation id" })] }), _jsxs("div", { className: "flex gap-2 items-end", children: [_jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1", children: "Operation hash (bytes32)" }), _jsx("input", { className: "input", value: lookupHash, onChange: (e) => setLookupHash(e.target.value) })] }), _jsx("button", { className: "btn", onClick: handleLookup, disabled: !timelockAddr || !lookupHash, children: "Lookup" })] }), lookupError && _jsxs("div", { className: "mt-2 text-xs text-error", children: ["Error: ", lookupError] }), lookupDebug && _jsx("div", { className: "mt-2 font-mono text-[11px] text-on-surface-variant opacity-60", children: lookupDebug }), opState && (_jsxs("div", { className: "mt-4", children: [_jsxs("div", { className: "flex items-center gap-4 flex-wrap mb-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-sm text-on-surface-variant", children: "State:" }), _jsx(StateBadge, { state: opState }), opEta && _jsx("span", { className: "text-xs text-on-surface-variant", children: opEta })] }), opState === 'Ready' && (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("button", { className: "btn btn-primary", onClick: handleExecute, disabled: !evm.isConnected || !derivedCalldata, children: "Execute" }), !evm.isConnected && _jsx("span", { className: "text-[11px] text-on-surface-variant", children: "Connect wallet to execute" }), evm.isConnected && !derivedCalldata && _jsx("span", { className: "text-[11px] text-on-surface-variant", children: "Load an operation from the sidebar first" })] })), (opState === 'Waiting' || opState === 'Ready') && (_jsx("button", { className: "btn bg-error/10 text-error border border-error/20 hover:bg-error/20", onClick: handleCancel, disabled: !evm.isConnected, children: "Cancel" })), opState === 'Done' && _jsx("span", { className: "text-xs text-on-surface-variant", children: "Already executed \u2014 nothing to do" })] }), derivedCalldata && (_jsxs("div", { className: "font-mono text-[11px] text-on-surface-variant leading-relaxed", children: [_jsxs("div", { children: ["target: ", derivedTarget] }), _jsxs("div", { children: ["predecessor: ", derivedPredecessor] }), _jsxs("div", { children: ["salt: ", derivedSalt ?? '(from form)'] }), _jsxs("div", { children: ["calldata: ", derivedCalldata.slice(0, 18), "\u2026"] })] }))] })), (executeTx.status !== 'idle' || cancelTx.status !== 'idle') && (_jsx("div", { className: "mt-3", children: _jsx(TxStatus, { state: executeTx.status !== 'idle' ? executeTx : cancelTx }) }))] })] }), _jsx("div", { className: "col-span-12 lg:col-span-4", children: _jsxs("div", { className: "bg-surface-container-low rounded-xl border border-outline-variant/10 p-6 sticky top-6", children: [_jsxs("div", { className: "flex items-center gap-3 mb-4", children: [_jsx("div", { className: "w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center", children: _jsx("span", { className: "material-symbols-outlined text-primary text-lg", children: "list_alt" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "font-headline text-base font-bold text-on-surface", children: "Active Operations" }), _jsx("p", { className: "text-[11px] text-on-surface-variant", children: "Pending & ready ops" })] }), _jsx("button", { className: "btn text-[11px] py-1 px-3", onClick: handleScan, disabled: scanning || !timelockAddr, children: scanning ? '…' : 'Scan' })] }), _jsx("div", { className: "mb-4", children: _jsx("input", { className: "input text-[11px]", placeholder: "From block", value: scanFromBlock, onChange: (e) => setScanFromBlock(e.target.value) }) }), scanError && _jsx("div", { className: "text-[11px] text-error mb-3", children: scanError }), !scanning && scannedOps.length === 0 && !scanError && (_jsx("div", { className: "text-xs text-on-surface-variant opacity-60 text-center py-4", children: "Press Scan to search." })), scanning && _jsx("div", { className: "text-xs text-on-surface-variant opacity-60 text-center py-4", children: "Scanning\u2026" }), _jsx("div", { className: "flex flex-col gap-3", children: scannedOps.map((op) => (_jsxs("div", { className: "bg-surface-container rounded-lg p-3 border border-outline-variant/10", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx(StateBadge, { state: op.state }), _jsxs("div", { className: "flex gap-2", children: [_jsx("a", { href: arbiscanTx(op.txHash), target: "_blank", rel: "noreferrer", className: "text-[10px] text-primary border border-primary/20 rounded px-1.5 py-0.5 hover:bg-primary/5 transition-colors no-underline", children: "\u2197 Scan" }), _jsx("button", { className: "btn text-[10px] py-0.5 px-2", onClick: () => {
                                                            setLookupHash(op.id);
                                                            setDerivedTarget(op.target);
                                                            setDerivedCalldata(op.data);
                                                            setDerivedPredecessor(op.predecessor);
                                                            setDerivedSalt(op.salt);
                                                            setOpState(op.state);
                                                            setOpEta(op.eta);
                                                        }, children: "Load" })] })] }), op.eta && _jsx("div", { className: "text-[10px] text-on-surface-variant mb-1", children: op.eta }), _jsxs("div", { className: "font-mono text-[10px] text-primary", children: [op.id.slice(0, 10), "\u2026", op.id.slice(-6)] }), _jsxs("div", { className: "font-mono text-[10px] text-on-surface-variant mt-1 opacity-60", children: [op.target.slice(0, 10), "\u2026", op.target.slice(-6)] })] }, op.id))) })] }) })] }));
}
