import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useMemo, useEffect } from 'react';
import { JsonRpcProvider, Interface } from 'ethers';
import TimelockControllerABI from '@/abis/TimelockController.json';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useTimelockOps } from '@/hooks/useTimelockOps';
import { EvmWalletButton } from '@/components/EvmWalletButton';
import { TxStatus } from '@/components/TxStatus';
import { CONTRACTS, ARB_SEPOLIA, ARBISCAN_API_KEY } from '@/config/chains';
import { encodeRegisterVault, encodeSetVaultState, encodeSetVaultOft, encodeSetPerformanceFeeBps, encodeSetMaintenanceFeeBps, encodeSetFeeRecipient, } from '@/utils/abiEncode';
import { hashOperation as localHashOp, formatDelay, randomSalt, formatCountdown } from '@/utils/timelock';
export function Timelock() {
    const evm = useEvmWallet();
    const ops = useTimelockOps(evm.signer);
    const [timelockAddr, setTimelockAddr] = useState(CONTRACTS.adminGateway ?? '');
    const [minDelay, setMinDelay] = useState('');
    const [opType, setOpType] = useState('registerVault');
    // generic operation params
    const [vaultId, setVaultId] = useState('1');
    const [addr1, setAddr1] = useState('');
    const [addr2, setAddr2] = useState('');
    const [addr3, setAddr3] = useState('');
    const [addr4, setAddr4] = useState('');
    const [bps, setBps] = useState('');
    const [vaultState, setVaultState] = useState('1');
    const [delay, setDelay] = useState('172800');
    const [salt, setSalt] = useState(randomSalt());
    const [predecessor, setPredecessor] = useState('0x0000000000000000000000000000000000000000000000000000000000000000');
    // Calldata computed reactively — always reflects current form state
    const { calldata, calldataError } = useMemo(() => {
        try {
            let data = '';
            switch (opType) {
                case 'registerVault':
                    data = encodeRegisterVault(addr1, addr2, addr3, addr4);
                    break;
                case 'setVaultState':
                    data = encodeSetVaultState(BigInt(vaultId || '0'), Number(vaultState));
                    break;
                case 'setVaultOft':
                    data = encodeSetVaultOft(BigInt(vaultId || '0'), addr1);
                    break;
                case 'setPerformanceFeeBps':
                    data = encodeSetPerformanceFeeBps(BigInt(vaultId || '0'), BigInt(bps || '0'));
                    break;
                case 'setMaintenanceFeeBps':
                    data = encodeSetMaintenanceFeeBps(BigInt(vaultId || '0'), BigInt(bps || '0'));
                    break;
                case 'setFeeRecipient':
                    data = encodeSetFeeRecipient(BigInt(vaultId || '0'), addr1);
                    break;
            }
            return { calldata: data, calldataError: null };
        }
        catch (e) {
            return { calldata: null, calldataError: e instanceof Error ? e.message : String(e) };
        }
    }, [opType, vaultId, addr1, addr2, addr3, addr4, bps, vaultState]);
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
    // check op state
    const [lookupHash, setLookupHash] = useState('');
    const [opState, setOpState] = useState(null);
    const [opEta, setOpEta] = useState(null);
    const [lookupDebug, setLookupDebug] = useState(null);
    const [lookupError, setLookupError] = useState(null);
    // derive hash + exec params from tx
    const [deriveTxHash, setDeriveTxHash] = useState('');
    const [deriving, setDeriving] = useState(false);
    const [deriveError, setDeriveError] = useState(null);
    // params extracted from CallScheduled — used for Execute directly
    const [derivedTarget, setDerivedTarget] = useState(null);
    const [derivedCalldata, setDerivedCalldata] = useState(null);
    const [derivedPredecessor, setDerivedPredecessor] = useState(null);
    const [derivedSalt, setDerivedSalt] = useState(null);
    const [scheduleTx, setScheduleTx] = useState({ status: 'idle' });
    const [executeTx, setExecuteTx] = useState({ status: 'idle' });
    const [cancelTx, setCancelTx] = useState({ status: 'idle' });
    // scan active operations
    const [scannedOps, setScannedOps] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState(null);
    const [scanFromBlock, setScanFromBlock] = useState('');
    async function loadMinDelay() {
        if (!timelockAddr || timelockAddr === '0x')
            return;
        const d = await ops.getMinDelay(timelockAddr, evm.provider ?? undefined);
        setMinDelay(formatDelay(Number(d)));
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
            // Use getTimestamp — works on both OZ v4 and v5, unambiguous
            const ts = await ops.getTimestamp(timelockAddr, lookupHash, wp);
            const tsNum = Number(ts);
            const now = Math.floor(Date.now() / 1000);
            const network = wp ? await wp.getNetwork() : null;
            setLookupDebug(`contract: ${timelockAddr} | hash: ${lookupHash.slice(0, 14)}… | timestamp: ${tsNum} | chain: ${network?.chainId ?? 'public RPC'}`);
            let state;
            if (tsNum === 0)
                state = 'Unset';
            else if (tsNum === 1)
                state = 'Done'; // DONE_TIMESTAMP
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
            // id is indexed (topics[1]); target/value/data/predecessor are in log.data
            const id = log.topics[1];
            const decoded = iface.decodeEventLog('CallScheduled', log.data, log.topics);
            setLookupHash(id);
            setDerivedTarget(decoded.target);
            setDerivedCalldata(decoded.data);
            setDerivedPredecessor(decoded.predecessor);
            // Extract salt from the CallSalt event (emitted alongside CallScheduled when salt != 0)
            const saltTopic = iface.getEvent('CallSalt').topicHash;
            const saltLog = receipt.logs.find((l) => l.topics[0] === saltTopic && l.topics[1] === id);
            if (saltLog) {
                const saltDecoded = iface.decodeEventLog('CallSalt', saltLog.data, saltLog.topics);
                setDerivedSalt(saltDecoded.salt);
            }
            else {
                setDerivedSalt('0x0000000000000000000000000000000000000000000000000000000000000000');
            }
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
        const result = await ops.cancel(timelockAddr, lookupHash);
        setCancelTx(result);
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
                    throw new Error(`Arbiscan: ${detail} (topic=${topic0.slice(0, 10)}…)`);
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
            // Build sets of IDs that are done or cancelled
            const doneIds = new Set();
            for (const log of executedLogs)
                doneIds.add(log.topics[1]);
            for (const log of cancelledLogs)
                doneIds.add(log.topics[1]);
            // Build salt map: id → salt
            const saltMap = new Map();
            for (const log of saltLogs) {
                const decoded = iface.decodeEventLog('CallSalt', log.data, log.topics);
                saltMap.set(log.topics[1], decoded.salt);
            }
            // Collect unique active operation IDs (index 0 only to avoid duplicates from batch)
            const seen = new Set();
            const active = [];
            for (const log of scheduledLogs) {
                const id = log.topics[1];
                const index = parseInt(log.topics[2], 16); // only process index 0 per id
                if (index !== 0 || seen.has(id) || doneIds.has(id))
                    continue;
                seen.add(id);
                const decoded = iface.decodeEventLog('CallScheduled', log.data, log.topics);
                active.push({
                    id,
                    target: decoded.target,
                    data: decoded.data,
                    predecessor: decoded.predecessor,
                    salt: saltMap.get(id) ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
                    txHash: log.transactionHash,
                });
            }
            // Resolve state for each active op
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
                return { ...op, state, eta: state === 'Waiting' ? formatCountdown(tsNum) : null, txHash: op.txHash };
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
    return (_jsxs("div", { children: [_jsxs("div", { className: "topbar", children: [_jsx("h2", { children: "Timelock \u2014 TimelockController" }), _jsx(EvmWalletButton, { address: evm.address, chainId: evm.chainId, chainName: ARB_SEPOLIA.name, onConnect: evm.connect, onSwitchNetwork: () => evm.switchNetwork(ARB_SEPOLIA.id), targetChainId: ARB_SEPOLIA.id })] }), _jsxs("div", { style: { display: 'flex', gap: 16, alignItems: 'flex-start' }, children: [_jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("section", { className: "card", children: [_jsx("h3", { children: "TimelockController" }), _jsxs("div", { style: { display: 'flex', gap: 12, alignItems: 'flex-end' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { className: "label", children: "TimelockController address" }), _jsx("input", { className: "input", value: timelockAddr, onChange: (e) => setTimelockAddr(e.target.value) })] }), _jsx("button", { className: "btn", onClick: loadMinDelay, children: "Load Min Delay" })] }), minDelay && _jsxs("div", { style: { marginTop: 8, color: '#aaa' }, children: ["Min delay: ", _jsx("strong", { children: minDelay })] })] }), _jsxs("section", { className: "card", children: [_jsx("h3", { children: "Schedule Operation" }), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("div", { className: "label", children: "Operation type" }), _jsxs("select", { className: "input", value: opType, onChange: (e) => setOpType(e.target.value), children: [_jsx("option", { value: "registerVault", children: "registerVault" }), _jsx("option", { value: "setVaultState", children: "setVaultState" }), _jsx("option", { value: "setVaultOft", children: "setVaultOft" }), _jsx("option", { value: "setPerformanceFeeBps", children: "setPerformanceFeeBps" }), _jsx("option", { value: "setMaintenanceFeeBps", children: "setMaintenanceFeeBps" }), _jsx("option", { value: "setFeeRecipient", children: "setFeeRecipient" })] })] }), _jsx(OpFields, { opType: opType, vaultId: vaultId, setVaultId: setVaultId, addr1: addr1, setAddr1: setAddr1, addr2: addr2, setAddr2: setAddr2, addr3: addr3, setAddr3: setAddr3, addr4: addr4, setAddr4: setAddr4, bps: bps, setBps: setBps, vaultState: vaultState, setVaultState: setVaultState }), _jsxs("div", { style: { display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { className: "label", children: "Delay (seconds)" }), _jsx("input", { className: "input", value: delay, onChange: (e) => setDelay(e.target.value) })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { className: "label", children: "Salt" }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("input", { className: "input", value: salt, onChange: (e) => setSalt(e.target.value), style: { flex: 1 } }), _jsx("button", { className: "btn", onClick: () => setSalt(randomSalt()), children: "Rand" })] })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { className: "label", children: "Predecessor" }), _jsx("input", { className: "input", value: predecessor, onChange: (e) => setPredecessor(e.target.value) })] })] }), _jsxs("div", { className: "state-block", style: { marginTop: 12 }, children: [calldataError && (_jsxs("div", { style: { fontSize: 12, color: '#ff6b6b', marginBottom: 8 }, children: ["Fill in all fields to encode: ", calldataError] })), calldata && (_jsxs(_Fragment, { children: [_jsx("div", { className: "label", children: "Encoded calldata" }), _jsx("div", { style: { wordBreak: 'break-all', fontSize: 11, color: '#666', marginBottom: 10, fontFamily: 'monospace' }, children: calldata })] })), opHash && (_jsxs("div", { style: { background: '#0e0e1a', border: '1px solid #3a3a5a', borderRadius: 6, padding: '10px 12px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }, children: [_jsx("span", { className: "label", style: { margin: 0 }, children: "Operation hash" }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("button", { className: "btn", style: { fontSize: 11, padding: '2px 8px' }, onClick: () => navigator.clipboard.writeText(opHash), children: "Copy" }), _jsx("button", { className: "btn", style: { fontSize: 11, padding: '2px 8px' }, onClick: () => setLookupHash(opHash), children: "Use for lookup" })] })] }), _jsx("div", { style: { fontFamily: 'monospace', fontSize: 12, color: '#a0a0ff', wordBreak: 'break-all' }, children: opHash }), _jsx("div", { style: { fontSize: 11, color: '#555', marginTop: 4 }, children: "Updates live as you change params \u2014 matches on-chain hashOperation()" })] }))] }), _jsx("div", { style: { marginTop: 12 }, children: _jsx("button", { className: "btn btn-primary", onClick: handleSchedule, disabled: !evm.isConnected || !calldata, children: "Schedule" }) }), _jsx("div", { style: { marginTop: 8 }, children: _jsx(TxStatus, { state: scheduleTx }) })] }), _jsxs("section", { className: "card", children: [_jsx("h3", { children: "Check Operation State" }), _jsxs("div", { style: { marginBottom: 16, padding: '10px 12px', background: '#0e0e1a', borderRadius: 6, border: '1px solid #2a2a3a' }, children: [_jsx("div", { className: "label", style: { marginBottom: 6 }, children: "Derive hash from schedule tx hash" }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'flex-end' }, children: [_jsx("input", { className: "input", style: { flex: 1 }, placeholder: "0x\u2026 (transaction hash of the schedule call)", value: deriveTxHash, onChange: (e) => setDeriveTxHash(e.target.value) }), _jsx("button", { className: "btn", onClick: handleDeriveFromTx, disabled: deriving || !deriveTxHash, children: deriving ? 'Fetching…' : 'Derive' })] }), deriveError && _jsx("div", { style: { fontSize: 12, color: '#ff6b6b', marginTop: 6 }, children: deriveError }), _jsx("div", { style: { fontSize: 11, color: '#555', marginTop: 6 }, children: "Reads the CallScheduled event from the tx receipt and extracts the operation id" })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'flex-end' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { className: "label", children: "Operation hash (bytes32)" }), _jsx("input", { className: "input", value: lookupHash, onChange: (e) => setLookupHash(e.target.value) })] }), _jsx("button", { className: "btn", onClick: handleLookup, disabled: !timelockAddr || !lookupHash, children: "Lookup" })] }), lookupError && _jsxs("div", { style: { marginTop: 8, fontSize: 12, color: '#ff6b6b' }, children: ["Error: ", lookupError] }), lookupDebug && _jsx("div", { style: { marginTop: 6, fontSize: 11, color: '#555', fontFamily: 'monospace' }, children: lookupDebug }), opState && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 8 }, children: [_jsxs("div", { style: { color: opState === 'Ready' ? '#6bcb77' : opState === 'Unset' ? '#ff6b6b' : opState === 'Done' ? '#888' : '#ffd93d' }, children: ["State: ", _jsx("strong", { children: opState }), opEta && _jsx("span", { style: { marginLeft: 8, color: '#888' }, children: opEta })] }), opState === 'Ready' && (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx("button", { className: "btn btn-primary", onClick: handleExecute, disabled: !evm.isConnected || !derivedCalldata, children: "Execute" }), !evm.isConnected && _jsx("span", { style: { fontSize: 11, color: '#888' }, children: "Connect wallet to execute" }), evm.isConnected && !derivedCalldata && _jsx("span", { style: { fontSize: 11, color: '#888' }, children: "Load an operation from the sidebar first" })] })), (opState === 'Waiting' || opState === 'Ready') && (_jsx("button", { className: "btn", style: { background: '#3a1a1a', color: '#ff6b6b', borderColor: '#5a2a2a' }, onClick: handleCancel, disabled: !evm.isConnected, children: "Cancel" })), opState === 'Done' && _jsx("span", { style: { fontSize: 12, color: '#555' }, children: "Already executed \u2014 nothing to do" })] }), derivedCalldata && (_jsxs("div", { style: { fontSize: 11, color: '#555', fontFamily: 'monospace', lineHeight: 1.6 }, children: [_jsxs("div", { children: ["target: ", derivedTarget] }), _jsxs("div", { children: ["predecessor: ", derivedPredecessor] }), _jsxs("div", { children: ["salt: ", derivedSalt ?? '(from form)'] }), _jsxs("div", { children: ["calldata: ", derivedCalldata.slice(0, 18), "\u2026"] })] }))] })), (executeTx.status !== 'idle' || cancelTx.status !== 'idle') && (_jsx("div", { style: { marginTop: 8 }, children: _jsx(TxStatus, { state: executeTx.status !== 'idle' ? executeTx : cancelTx }) }))] })] }), _jsx("div", { style: { width: 300, flexShrink: 0 }, children: _jsxs("div", { className: "card", style: { position: 'sticky', top: 16 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, children: [_jsx("h3", { style: { margin: 0 }, children: "Active Ops" }), _jsx("button", { className: "btn", style: { fontSize: 11, padding: '3px 10px' }, onClick: handleScan, disabled: scanning || !timelockAddr, children: scanning ? '…' : 'Scan' })] }), _jsx("div", { style: { display: 'flex', gap: 6, marginBottom: 10 }, children: _jsx("input", { className: "input", style: { fontSize: 11 }, placeholder: "From block", value: scanFromBlock, onChange: (e) => setScanFromBlock(e.target.value) }) }), scanError && _jsx("div", { style: { fontSize: 11, color: '#ff6b6b', marginBottom: 8 }, children: scanError }), !scanning && scannedOps.length === 0 && !scanError && (_jsx("div", { style: { fontSize: 12, color: '#555' }, children: "Press Scan to search." })), scanning && _jsx("div", { style: { fontSize: 12, color: '#555' }, children: "Scanning\u2026" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: scannedOps.map((op) => (_jsxs("div", { style: { background: '#0e0e1a', border: '1px solid #2a2a3a', borderRadius: 6, padding: '8px 10px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }, children: [_jsx("span", { style: {
                                                            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                                            background: op.state === 'Ready' ? '#1a3a1a' : '#2a2a0a',
                                                            color: op.state === 'Ready' ? '#6bcb77' : '#ffd93d',
                                                        }, children: op.state }), _jsxs("div", { style: { display: 'flex', gap: 4 }, children: [_jsx("a", { href: arbiscanTx(op.txHash), target: "_blank", rel: "noreferrer", style: { fontSize: 10, color: '#5865f2', textDecoration: 'none', padding: '1px 6px', border: '1px solid #3a3a5a', borderRadius: 4 }, children: "\u2197 Scan" }), _jsx("button", { className: "btn", style: { fontSize: 10, padding: '1px 6px' }, onClick: () => {
                                                                    setLookupHash(op.id);
                                                                    setDerivedTarget(op.target);
                                                                    setDerivedCalldata(op.data);
                                                                    setDerivedPredecessor(op.predecessor);
                                                                    setDerivedSalt(op.salt);
                                                                    setOpState(op.state);
                                                                    setOpEta(op.eta);
                                                                }, children: "Load" })] })] }), op.eta && _jsx("div", { style: { fontSize: 10, color: '#888', marginBottom: 4 }, children: op.eta }), _jsxs("div", { style: { fontFamily: 'monospace', fontSize: 10, color: '#a0a0ff' }, children: [op.id.slice(0, 10), "\u2026", op.id.slice(-6)] }), _jsxs("div", { style: { fontSize: 10, color: '#555', marginTop: 3, fontFamily: 'monospace' }, children: [op.target.slice(0, 10), "\u2026", op.target.slice(-6)] })] }, op.id))) })] }) })] })] }));
}
// Dynamic field rendering based on operation type
function OpFields({ opType, vaultId, setVaultId, addr1, setAddr1, addr2, setAddr2, addr3, setAddr3, addr4, setAddr4, bps, setBps, vaultState, setVaultState, }) {
    const F = ({ label, value, onChange }) => (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: label }), _jsx("input", { className: "input", value: value, onChange: (e) => onChange(e.target.value), spellCheck: false })] }));
    switch (opType) {
        case 'registerVault':
            return (_jsxs(_Fragment, { children: [_jsx(F, { label: "SyVault address", value: addr1, onChange: setAddr1 }), _jsx(F, { label: "LiquidityPool address", value: addr2, onChange: setAddr2 }), _jsx(F, { label: "SyShare address", value: addr3, onChange: setAddr3 }), _jsx(F, { label: "SyOFT address", value: addr4, onChange: setAddr4 })] }));
        case 'setVaultState':
            return (_jsxs(_Fragment, { children: [_jsx(F, { label: "Vault ID", value: vaultId, onChange: setVaultId }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("div", { className: "label", children: "New state" }), _jsxs("select", { className: "input", value: vaultState, onChange: (e) => setVaultState(e.target.value), children: [_jsx("option", { value: "0", children: "0 \u2014 Pending" }), _jsx("option", { value: "1", children: "1 \u2014 Active" }), _jsx("option", { value: "2", children: "2 \u2014 Deprecated" }), _jsx("option", { value: "3", children: "3 \u2014 Closed" })] })] })] }));
        case 'setVaultOft':
            return (_jsxs(_Fragment, { children: [_jsx(F, { label: "Vault ID", value: vaultId, onChange: setVaultId }), _jsx(F, { label: "SyOFT address", value: addr1, onChange: setAddr1 })] }));
        case 'setPerformanceFeeBps':
        case 'setMaintenanceFeeBps':
            return (_jsxs(_Fragment, { children: [_jsx(F, { label: "Vault ID", value: vaultId, onChange: setVaultId }), _jsx(F, { label: "Fee BPS (e.g. 1000 = 10%)", value: bps, onChange: setBps })] }));
        case 'setFeeRecipient':
            return (_jsxs(_Fragment, { children: [_jsx(F, { label: "Vault ID", value: vaultId, onChange: setVaultId }), _jsx(F, { label: "Fee recipient address", value: addr1, onChange: setAddr1 })] }));
        default:
            return _jsx(_Fragment, {});
    }
}
