import { useState, useMemo, useEffect } from 'react';
import { JsonRpcProvider, Interface, FunctionFragment } from 'ethers';
import TimelockControllerABI from '@/abis/evm/TimelockController.json';
import timelockTarget from '@/config/timelockTarget.json';
import { useWallet } from '@/context/WalletContext';
import { useTimelockOps } from '@/hooks/useTimelockOps';
import { useCairoTimelock } from '@/hooks/useCairoTimelock';
import { TxStatus } from '@/components/TxStatus';
import { Section } from '@/components/Section';
import { SwitchChainButton } from '@/components/ChainSwitch';
import { CONTRACTS, ARBISCAN_API_KEY, STARKNET_TESTNET, STARKNET_MAINNET } from '@/config/chains';
import { hashOperation as localHashOp, formatDelay, randomSalt, formatCountdown } from '@/utils/timelock';
import OFTAdapterABI from '@/abis/evm/OFTAdapter.json';
import OFTABI from '@/abis/evm/OFT.json';
import EndpointV2ABI from '@/abis/evm/EndpointV2.json';
import ERC20ABI from '@/abis/evm/ERC20.json';
import AccessControlABI from '@/abis/evm/AccessControl.json';
import type { TxState, OperationState } from '@/types';
import { VaultState } from '@/types';

// ── Parse timelockTarget.json once ───────────────────────────────────────────
const TARGET_IFACE = new Interface(timelockTarget.abi);
const WRITE_FUNCTIONS = TARGET_IFACE.fragments.filter(
  (f): f is FunctionFragment =>
    FunctionFragment.isFragment(f) &&
    f.stateMutability !== 'view' &&
    f.stateMutability !== 'pure',
);

function parseArg(value: string, type: string): unknown {
  if (type === 'bool') return value === 'true' || value === '1';
  if (type.startsWith('uint') || type.startsWith('int')) return BigInt(value || '0');
  return value; // address, bytes*, string
}

// ── Calldata decoder — tries multiple ABIs ──────────────────────────────────
const DECODE_IFACES = [
  { name: 'Target',          iface: TARGET_IFACE },
  { name: 'TimelockController', iface: new Interface(TimelockControllerABI) },
  { name: 'OFTAdapter',      iface: new Interface(OFTAdapterABI) },
  { name: 'OFT',             iface: new Interface(OFTABI) },
  { name: 'EndpointV2',      iface: new Interface(EndpointV2ABI) },
  { name: 'ERC20',           iface: new Interface(ERC20ABI) },
  { name: 'AccessControl',   iface: new Interface(AccessControlABI) },
];

interface DecodedCall { contract: string; fn: string; args: Record<string, string> }

function decodeCalldata(data: string): DecodedCall | null {
  if (!data || data === '0x' || data.length < 10) return null;
  for (const { name, iface } of DECODE_IFACES) {
    try {
      const parsed = iface.parseTransaction({ data, value: 0n });
      if (!parsed) continue;
      const args: Record<string, string> = {};
      parsed.fragment.inputs.forEach((input, i) => {
        const val = parsed.args[i];
        args[input.name || `arg${i}`] = typeof val === 'bigint' ? val.toString() : String(val);
      });
      return { contract: name, fn: parsed.name, args };
    } catch { /* try next */ }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

interface ScannedOp {
  id: string;
  target: string;
  data: string;
  predecessor: string;
  salt: string;
  state: OperationState;
  eta: string | null;
  txHash: string;
}

function StateBadge({ state }: { state: OperationState }): JSX.Element {
  if (state === 'Ready')   return <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-secondary/10 text-secondary border border-secondary/20">Ready</span>;
  if (state === 'Waiting') return <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-tertiary/10 text-tertiary border border-tertiary/20">Waiting</span>;
  if (state === 'Done')    return <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-outline-variant/20 text-on-surface-variant">Done</span>;
  return <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-error/10 text-error border border-error/20">Unset</span>;
}

const TIMELOCK_CHAINS = [
  { id: 1,       name: 'Ethereum',         rpc: 'https://eth.llamarpc.com',           explorer: 'etherscan.io',             isTestnet: false },
  { id: 42161,   name: 'Arbitrum',          rpc: 'https://arb1.arbitrum.io/rpc',       explorer: 'arbiscan.io',              isTestnet: false },
  { id: 10,      name: 'Optimism',          rpc: 'https://mainnet.optimism.io',        explorer: 'optimistic.etherscan.io',  isTestnet: false },
  { id: 8453,    name: 'Base',              rpc: 'https://mainnet.base.org',           explorer: 'basescan.org',             isTestnet: false },
  { id: 137,     name: 'Polygon',           rpc: 'https://polygon-rpc.com',            explorer: 'polygonscan.com',          isTestnet: false },
  { id: 56,      name: 'BNB Chain',         rpc: 'https://bsc-dataseed.binance.org',   explorer: 'bscscan.com',              isTestnet: false },
  { id: 43114,   name: 'Avalanche',         rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'snowscan.xyz',          isTestnet: false },
  { id: 11155111,name: 'Sepolia',           rpc: 'https://rpc.sepolia.org',            explorer: 'sepolia.etherscan.io',     isTestnet: true },
  { id: 421614,  name: 'Arbitrum Sepolia',  rpc: 'https://arbitrum-sepolia.publicnode.com', explorer: 'sepolia.arbiscan.io',  isTestnet: true },
  { id: 11155420,name: 'Optimism Sepolia',  rpc: 'https://sepolia.optimism.io',        explorer: 'sepolia-optimism.etherscan.io', isTestnet: true },
  { id: 84532,   name: 'Base Sepolia',      rpc: 'https://sepolia.base.org',           explorer: 'sepolia.basescan.org',     isTestnet: true },
];

type ChainType = 'evm' | 'starknet';

const STARK_CHAINS: Record<'mainnet' | 'testnet', { id: string; name: string; rpc: string; explorer: string }> = {
  mainnet: { id: 'SN_MAIN',    name: 'Starknet Mainnet', rpc: STARKNET_MAINNET.rpc, explorer: 'voyager.online' },
  testnet: { id: 'SN_SEPOLIA', name: 'Starknet Sepolia', rpc: STARKNET_TESTNET.rpc, explorer: 'sepolia.voyager.online' },
};

export function Timelock(): JSX.Element {
  const { evm, stark } = useWallet();
  const ops = useTimelockOps(evm.signer);
  const cairoOps = useCairoTimelock(stark.account);
  const [chainType, setChainType] = useState<ChainType>('evm');

  // Testnet/Mainnet toggle — filters EVM chains and auto-sets Starknet chain
  const [isTestnet, setIsTestnet] = useState(true);
  const filteredChains = TIMELOCK_CHAINS.filter((c) => c.isTestnet === isTestnet);
  const starkChain = isTestnet ? STARK_CHAINS.testnet : STARK_CHAINS.mainnet;

  // EVM chain selection (persisted)
  const [activeChainId, setActiveChainId] = useState<number>(() => {
    try { const s = localStorage.getItem('ozlz_timelock_chain'); return s ? Number(s) : 421614; } catch { return 421614; }
  });
  function selectChain(id: number) {
    setActiveChainId(id);
    try { localStorage.setItem('ozlz_timelock_chain', String(id)); } catch { /* */ }
  }
  // When toggling testnet/mainnet, reset to the first chain in the new list
  function handleNetworkToggle(testnet: boolean) {
    setIsTestnet(testnet);
    const first = TIMELOCK_CHAINS.find((c) => c.isTestnet === testnet);
    if (first) selectChain(first.id);
  }
  const selectedChain = filteredChains.find((c) => c.id === activeChainId) ?? filteredChains[0];
  const wrongChain = evm.isConnected && evm.chainId !== selectedChain.id;

  const [timelockAddr, setTimelockAddr] = useState(CONTRACTS.adminGateway ?? '');
  const [minDelay,     setMinDelay]     = useState<string>('');

  // ── Dynamic function picker ───────────────────────────────────────────────
  const [selectedFn, setSelectedFn] = useState(WRITE_FUNCTIONS[0]?.name ?? '');
  const [fnArgs,     setFnArgs]     = useState<string[]>(() =>
    WRITE_FUNCTIONS[0] ? WRITE_FUNCTIONS[0].inputs.map(() => '') : [],
  );

  const currentFn = WRITE_FUNCTIONS.find((f) => f.name === selectedFn) ?? null;

  useEffect(() => {
    setFnArgs(currentFn ? currentFn.inputs.map(() => '') : []);
  }, [selectedFn]); // eslint-disable-line react-hooks/exhaustive-deps

  function setArg(i: number, value: string) {
    setFnArgs((prev) => { const next = [...prev]; next[i] = value; return next; });
  }

  // ── Calldata encoding ─────────────────────────────────────────────────────
  const { calldata, calldataError } = useMemo(() => {
    if (!currentFn) return { calldata: null, calldataError: 'No function selected' };
    if (fnArgs.some((v) => v === '' && currentFn.inputs[fnArgs.indexOf(v)]?.type !== 'string'))
      return { calldata: null, calldataError: null }; // not ready yet, no error shown
    try {
      const parsed = fnArgs.map((v, i) => parseArg(v, currentFn.inputs[i].type));
      const data = TARGET_IFACE.encodeFunctionData(currentFn.name, parsed);
      return { calldata: data, calldataError: null };
    } catch (e) {
      return { calldata: null, calldataError: e instanceof Error ? e.message : String(e) };
    }
  }, [currentFn, fnArgs]);

  // ── Timelock params ───────────────────────────────────────────────────────
  const [delay,       setDelay]       = useState('172800');
  const [salt,        setSalt]        = useState(randomSalt());
  const [predecessor, setPredecessor] = useState('0x0000000000000000000000000000000000000000000000000000000000000000');

  const [lastCalldata, setLastCalldata] = useState<string | null>(null);
  useEffect(() => { if (calldata) setLastCalldata(calldata); }, [calldata]);
  const execCalldata = calldata ?? lastCalldata;

  const freshOpHash = execCalldata && timelockAddr
    ? localHashOp(timelockAddr, 0n, execCalldata, predecessor, salt)
    : null;
  const [lastOpHash, setLastOpHash] = useState<string | null>(null);
  useEffect(() => { if (freshOpHash) setLastOpHash(freshOpHash); }, [freshOpHash]);
  const opHash = freshOpHash ?? lastOpHash;

  // ── Check op state ────────────────────────────────────────────────────────
  const [lookupHash,  setLookupHash]  = useState('');
  const [opState,     setOpState]     = useState<OperationState | null>(null);
  const [opEta,       setOpEta]       = useState<string | null>(null);
  const [lookupDebug, setLookupDebug] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [deriveTxHash,       setDeriveTxHash]       = useState('');
  const [deriving,           setDeriving]           = useState(false);
  const [deriveError,        setDeriveError]        = useState<string | null>(null);
  const [derivedTarget,      setDerivedTarget]      = useState<string | null>(null);
  const [derivedCalldata,    setDerivedCalldata]    = useState<string | null>(null);
  const [derivedPredecessor, setDerivedPredecessor] = useState<string | null>(null);
  const [derivedSalt,        setDerivedSalt]        = useState<string | null>(null);

  const [scheduleTx, setScheduleTx] = useState<TxState>({ status: 'idle' });
  const [executeTx,  setExecuteTx]  = useState<TxState>({ status: 'idle' });
  const [cancelTx,   setCancelTx]   = useState<TxState>({ status: 'idle' });

  const [scannedOps,   setScannedOps]   = useState<ScannedOp[]>([]);
  const [scanning,     setScanning]     = useState(false);
  const [scanError,    setScanError]    = useState<string | null>(null);
  const [scanFromBlock, setScanFromBlock] = useState('');
  const [opFilter, setOpFilter] = useState<'all' | 'Waiting' | 'Ready' | 'Done'>('all');

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function loadMinDelay(): Promise<void> {
    if (!timelockAddr) return;
    if (chainType === 'starknet') {
      const d = await cairoOps.getMinDelay(timelockAddr, starkChain.rpc);
      setMinDelay(formatDelay(Number(d)));
      setDelay(String(d));
    } else {
      const d = await ops.getMinDelay(timelockAddr, evm.provider ?? undefined);
      setMinDelay(formatDelay(Number(d)));
      setDelay(String(d));
    }
  }

  async function handleSchedule(): Promise<void> {
    if (!timelockAddr || !calldata) return;
    setScheduleTx({ status: 'pending' });
    if (chainType === 'starknet') {
      // Cairo schedule expects Call struct {to, selector, calldata}
      // Target = the timelock itself (same as EVM pattern), selector from the encoded calldata
      const fnSelector = calldata.slice(0, 10); // first 4 bytes as selector
      const result = await cairoOps.schedule(timelockAddr, timelockAddr, fnSelector, [calldata], predecessor, salt, Number(delay));
      setScheduleTx(result);
    } else {
      const result = await ops.schedule(timelockAddr, 0n, calldata, predecessor, salt, BigInt(delay));
      setScheduleTx(result);
    }
  }

  async function handleLookup(): Promise<void> {
    if (!timelockAddr || !lookupHash) return;
    setOpState(null); setOpEta(null); setLookupDebug(null); setLookupError(null);
    try {
      if (chainType === 'starknet') {
        const state = await cairoOps.getOperationState(timelockAddr, lookupHash, starkChain.rpc);
        setOpState(state);
        if (state === 'Waiting') {
          const ts = await cairoOps.getTimestamp(timelockAddr, lookupHash, starkChain.rpc);
          setOpEta(formatCountdown(Number(ts)));
        }
        setLookupDebug(`contract: ${timelockAddr} | hash: ${lookupHash.slice(0, 14)}… | chain: ${starkChain.name}`);
      } else {
        const wp = evm.provider ?? undefined;
        const ts = await ops.getTimestamp(timelockAddr, lookupHash, wp);
        const tsNum = Number(ts);
        const now = Math.floor(Date.now() / 1000);
        const network = wp ? await wp.getNetwork() : null;
        setLookupDebug(`contract: ${timelockAddr} | hash: ${lookupHash.slice(0, 14)}… | timestamp: ${tsNum} | chain: ${network?.chainId ?? 'public RPC'}`);
        let state: OperationState;
        if (tsNum === 0) state = 'Unset';
        else if (tsNum === 1) state = 'Done';
        else if (tsNum <= now) state = 'Ready';
        else state = 'Waiting';
        setOpState(state);
        if (state === 'Waiting') setOpEta(formatCountdown(tsNum));
      }
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleExecute(): Promise<void> {
    const target = derivedTarget ?? timelockAddr;
    const data = derivedCalldata ?? execCalldata;
    const pred = derivedPredecessor ?? predecessor;
    const s = derivedSalt ?? salt;
    if (!target || !data) return;
    setExecuteTx({ status: 'pending' });
    if (chainType === 'starknet') {
      const fnSelector = data.slice(0, 10);
      const result = await cairoOps.execute(timelockAddr, target, fnSelector, [data], pred, s);
      setExecuteTx(result);
    } else {
      const result = await ops.execute(target, 0n, data, pred, s);
      setExecuteTx(result);
    }
  }

  async function handleDeriveFromTx(): Promise<void> {
    if (!deriveTxHash) return;
    setDeriving(true); setDeriveError(null);
    try {
      const provider = evm.provider ?? new JsonRpcProvider(selectedChain.rpc);
      const receipt = await provider.getTransactionReceipt(deriveTxHash);
      if (!receipt) { setDeriveError('Transaction not found'); return; }
      const iface = new Interface(TimelockControllerABI);
      const eventTopic = iface.getEvent('CallScheduled')!.topicHash;
      const log = receipt.logs.find((l) => l.topics[0] === eventTopic);
      if (!log) { setDeriveError('No CallScheduled event found in this transaction'); return; }
      const id = log.topics[1];
      const decoded = iface.decodeEventLog('CallScheduled', log.data, log.topics);
      setLookupHash(id);
      setDerivedTarget(decoded.target as string);
      setDerivedCalldata(decoded.data as string);
      setDerivedPredecessor(decoded.predecessor as string);
      const saltTopic = iface.getEvent('CallSalt')!.topicHash;
      const saltLog = receipt.logs.find((l) => l.topics[0] === saltTopic && l.topics[1] === id);
      setDerivedSalt(saltLog
        ? (iface.decodeEventLog('CallSalt', saltLog.data, saltLog.topics).salt as string)
        : '0x0000000000000000000000000000000000000000000000000000000000000000');
    } catch (e) {
      setDeriveError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeriving(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!timelockAddr || !lookupHash) return;
    setCancelTx({ status: 'pending' });
    if (chainType === 'starknet') {
      setCancelTx(await cairoOps.cancel(timelockAddr, lookupHash));
    } else {
      setCancelTx(await ops.cancel(timelockAddr, lookupHash));
    }
  }

  async function handleScan(): Promise<void> {
    if (!timelockAddr) return;
    setScanning(true); setScanError(null); setScannedOps([]);
    try {
      const iface = new Interface(TimelockControllerABI);
      const scheduledTopic = iface.getEvent('CallScheduled')!.topicHash;
      const executedTopic  = iface.getEvent('CallExecuted')!.topicHash;
      const cancelledTopic = iface.getEvent('Cancelled')!.topicHash;
      const saltTopic      = iface.getEvent('CallSalt')!.topicHash;
      // Use user API key from Settings, fall back to env var
      const userKey = (() => { try { return localStorage.getItem('ozlz_explorer_api_key') ?? ''; } catch { return ''; } })();
      const apiKey = userKey || ARBISCAN_API_KEY;
      // Auto-detect starting block if not specified
      let fromBlock = scanFromBlock.trim();
      if (!fromBlock) {
        try {
          const { JsonRpcProvider } = await import('ethers');
          const p = new JsonRpcProvider(selectedChain.rpc, undefined, { staticNetwork: true });
          const latest = await p.getBlockNumber();
          fromBlock = String(Math.max(0, latest - 100000));
        } catch { fromBlock = '0'; }
      }
      const base = `https://api.etherscan.io/v2/api?chainid=${selectedChain.id}&module=logs&action=getLogs&address=${timelockAddr}&fromBlock=${fromBlock}&toBlock=latest&apikey=${apiKey}`;
      type ArbLog = { topics: string[]; data: string; transactionHash: string };
      async function fetchLogs(topic0: string): Promise<ArbLog[]> {
        const res = await fetch(`${base}&topic0=${topic0}`);
        const json = await res.json() as { status: string; message?: string; result: unknown };
        if (!Array.isArray(json.result)) {
          const detail = typeof json.result === 'string' ? json.result : (json.message ?? 'unknown error');
          if (detail === 'No records found') return [];
          throw new Error(`Arbiscan: ${detail}`);
        }
        return json.result as ArbLog[];
      }
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const scheduledLogs = await fetchLogs(scheduledTopic); await wait(400);
      const executedLogs  = await fetchLogs(executedTopic);  await wait(400);
      const cancelledLogs = await fetchLogs(cancelledTopic); await wait(400);
      const saltLogs      = await fetchLogs(saltTopic);
      const doneIds = new Set<string>();
      for (const log of executedLogs)  doneIds.add(log.topics[1]);
      for (const log of cancelledLogs) doneIds.add(log.topics[1]);
      const saltMap = new Map<string, string>();
      for (const log of saltLogs) {
        const d = iface.decodeEventLog('CallSalt', log.data, log.topics);
        saltMap.set(log.topics[1], d.salt as string);
      }
      const seen = new Set<string>();
      const active: { id: string; target: string; data: string; predecessor: string; salt: string; txHash: string }[] = [];
      for (const log of scheduledLogs) {
        const id = log.topics[1];
        const index = parseInt(log.topics[2], 16);
        if (index !== 0 || seen.has(id) || doneIds.has(id)) continue;
        seen.add(id);
        const decoded = iface.decodeEventLog('CallScheduled', log.data, log.topics);
        active.push({ id, target: decoded.target as string, data: decoded.data as string, predecessor: decoded.predecessor as string,
          salt: saltMap.get(id) ?? '0x0000000000000000000000000000000000000000000000000000000000000000', txHash: log.transactionHash });
      }
      const now = Math.floor(Date.now() / 1000);
      const wp = evm.provider ?? undefined;
      const results: ScannedOp[] = await Promise.all(active.map(async (op) => {
        const ts = await ops.getTimestamp(timelockAddr, op.id, wp);
        const tsNum = Number(ts);
        let state: OperationState;
        if (tsNum === 0) state = 'Unset';
        else if (tsNum === 1) state = 'Done';
        else if (tsNum <= now) state = 'Ready';
        else state = 'Waiting';
        return { ...op, state, eta: state === 'Waiting' ? formatCountdown(tsNum) : null };
      }));
      setScannedOps(results);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  const explorerTx = (hash: string) => `https://${selectedChain.explorer}/tx/${hash}`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-12 gap-6">

      {/* ── Left: main content ── */}
      <div className="col-span-12 lg:col-span-8 space-y-6">

        <Section icon="schedule" title="TimelockController" subtitle="Contract address and configuration">
          {/* Chain type toggle + network mode */}
          <div className="flex gap-2 items-center mb-4 flex-wrap">
            <button className={`tab-btn ${chainType === 'evm' ? 'tab-btn-active' : ''}`}
              onClick={() => { setChainType('evm'); setMinDelay(''); }}>EVM</button>
            <button className={`tab-btn ${chainType === 'starknet' ? 'tab-btn-active' : ''}`}
              onClick={() => { setChainType('starknet'); setMinDelay(''); }}>Starknet</button>

            <span className="w-px h-5 bg-outline-variant/20 mx-1" />

            <button className={`tab-btn ${isTestnet ? 'tab-btn-active' : ''}`}
              onClick={() => handleNetworkToggle(true)}>Testnet</button>
            <button className={`tab-btn ${!isTestnet ? 'tab-btn-active' : ''}`}
              onClick={() => handleNetworkToggle(false)}>Mainnet</button>

            {/* Chain selector */}
            {chainType === 'evm' && (
              <div className="ml-auto flex items-center gap-2">
                <select className="input text-xs w-44" value={selectedChain.id}
                  onChange={(e) => selectChain(Number(e.target.value))}>
                  {filteredChains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {wrongChain && (
                  <SwitchChainButton chainName={selectedChain.name} onSwitch={() => evm.switchNetwork(selectedChain.id)} />
                )}
              </div>
            )}
            {chainType === 'starknet' && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-on-surface-variant">{starkChain.name}</span>
                {stark.isConnected && <span className="flex items-center gap-1.5 text-xs text-tertiary"><span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>Connected</span>}
              </div>
            )}
          </div>

          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <div className="label">TimelockController address</div>
              <input className="input" value={timelockAddr} onChange={(e) => setTimelockAddr(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <button className="btn" onClick={loadMinDelay}>Load Min Delay</button>
          </div>
          {minDelay && (
            <div className="mt-3 text-sm text-on-surface-variant">
              Min delay: <strong className="text-on-surface">{minDelay}</strong>
            </div>
          )}
        </Section>

        {/* Schedule Operation */}
        <Section icon="add_circle" title="Schedule Operation" subtitle="Encode and schedule a timelock operation">

          {WRITE_FUNCTIONS.length === 0 ? (
            <div className="text-xs text-on-surface-variant bg-surface-container rounded-lg p-4 border border-outline-variant/10">
              No write functions found in <span className="font-mono">src/config/timelockTarget.json</span>. Replace the ABI with your contract's ABI.
            </div>
          ) : (
            <>
              <div className="mb-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Function</div>
                <select className="input" value={selectedFn} onChange={(e) => setSelectedFn(e.target.value)}>
                  {WRITE_FUNCTIONS.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </select>
              </div>

              {/* Dynamic inputs */}
              {currentFn && currentFn.inputs.length > 0 && (
                <div className="mb-4 space-y-3">
                  {currentFn.inputs.map((input, i) => (
                    <div key={i}>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">
                        {input.name || `arg${i}`}
                        <span className="ml-1.5 normal-case text-primary/60 font-normal">({input.type})</span>
                      </div>
                      {selectedFn === 'setVaultState' && input.name === 'state' ? (
                        <select
                          className="input"
                          value={fnArgs[i] ?? '0'}
                          onChange={(e) => setArg(i, e.target.value)}
                        >
                          {Object.entries(VaultState)
                            .filter(([, v]) => typeof v === 'number')
                            .map(([label, val]) => (
                              <option key={val} value={String(val)}>{label} ({val})</option>
                            ))}
                        </select>
                      ) : (
                        <input
                          className="input"
                          value={fnArgs[i] ?? ''}
                          onChange={(e) => setArg(i, e.target.value)}
                          spellCheck={false}
                          placeholder={input.type === 'address' ? '0x…' : input.type.startsWith('uint') ? '0' : ''}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {currentFn && currentFn.inputs.length === 0 && (
                <div className="mb-4 text-xs text-on-surface-variant">No inputs — this function takes no arguments.</div>
              )}
            </>
          )}

          <div className="flex gap-3 mt-4 flex-wrap">
            <div className="flex-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Delay (seconds)</div>
              <input className="input" value={delay} onChange={(e) => setDelay(e.target.value)} />
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Salt</div>
              <div className="flex gap-2">
                <input className="input flex-1" value={salt} onChange={(e) => setSalt(e.target.value)} />
                <button className="btn" onClick={() => setSalt(randomSalt())}>Rand</button>
              </div>
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Predecessor</div>
              <input className="input" value={predecessor} onChange={(e) => setPredecessor(e.target.value)} />
            </div>
          </div>

          <div className="mt-4">
            {calldataError && (
              <div className="text-xs text-error mb-3">{calldataError}</div>
            )}
            {calldata && (
              <div className="mb-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Encoded calldata</div>
                <div className="font-mono text-[11px] text-on-surface-variant break-all">{calldata}</div>
              </div>
            )}
            {opHash && (
              <div className="bg-surface-container rounded-lg p-4 border border-primary/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Operation hash</span>
                  <div className="flex gap-2">
                    <button className="btn text-[11px] py-0.5 px-2" onClick={() => navigator.clipboard.writeText(opHash)}>Copy</button>
                    <button className="btn text-[11px] py-0.5 px-2" onClick={() => setLookupHash(opHash)}>Use for lookup</button>
                  </div>
                </div>
                <div className="font-mono text-xs text-primary break-all">{opHash}</div>
                <div className="text-[11px] text-on-surface-variant mt-2 opacity-60">
                  Updates live as you change params — matches on-chain hashOperation()
                </div>
              </div>
            )}
          </div>

          <div className="mt-4">
            {chainType === 'evm' && wrongChain ? (
              <SwitchChainButton chainName={selectedChain.name} onSwitch={() => evm.switchNetwork(selectedChain.id)} />
            ) : (
              <button className="btn btn-primary" onClick={handleSchedule}
                disabled={chainType === 'starknet' ? !stark.isConnected || !calldata : !evm.isConnected || !calldata}>
                Schedule{chainType === 'starknet' ? ' (Starknet)' : ''}
              </button>
            )}
          </div>
          <div className="mt-3"><TxStatus state={scheduleTx} /></div>
        </Section>

        {/* Check Operation State */}
        <Section icon="search" title="Check Operation State" subtitle="Lookup operation status by hash">

          <div className="bg-surface-container rounded-lg p-4 mb-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-2">Derive hash from schedule tx hash</div>
            <div className="flex gap-2 items-end">
              <input className="input flex-1" placeholder="0x… (transaction hash of the schedule call)"
                value={deriveTxHash} onChange={(e) => setDeriveTxHash(e.target.value)} />
              <button className="btn" onClick={handleDeriveFromTx} disabled={deriving || !deriveTxHash}>
                {deriving ? 'Fetching…' : 'Derive'}
              </button>
            </div>
            {deriveError && <div className="text-xs text-error mt-2">{deriveError}</div>}
            <div className="text-[11px] text-on-surface-variant mt-2 opacity-60">
              Reads the CallScheduled event from the tx receipt and extracts the operation id
            </div>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Operation hash (bytes32)</div>
              <input className="input" value={lookupHash} onChange={(e) => setLookupHash(e.target.value)} />
            </div>
            <button className="btn" onClick={handleLookup} disabled={!timelockAddr || !lookupHash}>Lookup</button>
          </div>
          {lookupError && <div className="mt-2 text-xs text-error">Error: {lookupError}</div>}
          {lookupDebug && <div className="mt-2 font-mono text-[11px] text-on-surface-variant opacity-60">{lookupDebug}</div>}

          {opState && (
            <div className="mt-4">
              <div className="flex items-center gap-4 flex-wrap mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-on-surface-variant">State:</span>
                  <StateBadge state={opState} />
                  {opEta && <span className="text-xs text-on-surface-variant">{opEta}</span>}
                </div>
                {opState === 'Ready' && !wrongChain && (
                  <div className="flex flex-col gap-1">
                    <button className="btn btn-primary" onClick={handleExecute}
                      disabled={chainType === 'starknet' ? !stark.isConnected || !derivedCalldata : !evm.isConnected || !derivedCalldata}>Execute</button>
                    {(chainType === 'evm' ? evm.isConnected : stark.isConnected) && !derivedCalldata && <span className="text-[11px] text-on-surface-variant">Load an operation from the sidebar first</span>}
                  </div>
                )}
                {(opState === 'Waiting' || opState === 'Ready') && !wrongChain && (
                  <button className="btn btn-danger"
                    onClick={handleCancel} disabled={chainType === 'starknet' ? !stark.isConnected : !evm.isConnected}>Cancel</button>
                )}
                {(opState === 'Ready' || opState === 'Waiting') && wrongChain && chainType === 'evm' && (
                  <SwitchChainButton chainName={selectedChain.name} onSwitch={() => evm.switchNetwork(selectedChain.id)} />
                )}
                {opState === 'Done' && <span className="text-xs text-on-surface-variant">Already executed — nothing to do</span>}
              </div>
              {derivedCalldata && (() => {
                const decoded = decodeCalldata(derivedCalldata);
                return (
                  <div className="text-[11px] leading-relaxed">
                    {decoded && (
                      <div className="bg-surface-container rounded-lg p-3 border border-outline-variant/10 mb-2">
                        <div className="label mb-1">Decoded</div>
                        <div className="text-primary font-semibold font-mono">{decoded.fn}()</div>
                        <div className="text-[10px] text-on-surface-variant mb-1">{decoded.contract}</div>
                        {Object.entries(decoded.args).map(([k, v]) => (
                          <div key={k} className="font-mono text-on-surface-variant">
                            <span className="text-on-surface">{k}</span>: {v}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="font-mono text-on-surface-variant">
                      <div>target: {derivedTarget}</div>
                      <div>predecessor: {derivedPredecessor}</div>
                      <div>salt: {derivedSalt ?? '(from form)'}</div>
                      {!decoded && <div>calldata: {derivedCalldata.slice(0, 18)}…</div>}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {(executeTx.status !== 'idle' || cancelTx.status !== 'idle') && (
            <div className="mt-3">
              <TxStatus state={executeTx.status !== 'idle' ? executeTx : cancelTx} />
            </div>
          )}
        </Section>
      </div>

      {/* ── Right: active operations sidebar ── */}
      <div className="col-span-12 lg:col-span-4">
        <Section icon="list_alt" title="Operations" subtitle={chainType === 'starknet' ? 'Event scan not available on Starknet' : scannedOps.length > 0 ? `${scannedOps.length} found` : 'Scan to discover'}
          actions={chainType === 'evm' ? (
            <button className="btn btn-sm" onClick={handleScan} disabled={scanning || !timelockAddr}>
              {scanning ? '…' : 'Scan'}
            </button>
          ) : null}>
          {chainType === 'starknet' && (
            <div className="text-xs text-on-surface-variant opacity-60 text-center py-4">
              Event scanning is not available for Starknet — use the Lookup section to check operation state by hash.
            </div>
          )}
          {chainType === 'evm' && (
          <div className="mb-4">
            <div className="label">From block</div>
            <input className="input" placeholder="Auto (~100k blocks back)"
              value={scanFromBlock} onChange={(e) => setScanFromBlock(e.target.value)} />
          </div>
          )}

          {scanError && <div className="text-[11px] text-error mb-3">{scanError}</div>}
          {!scanning && scannedOps.length === 0 && !scanError && (
            <div className="text-xs text-on-surface-variant opacity-60 text-center py-4">Press Scan to search.</div>
          )}
          {scanning && <div className="text-xs text-on-surface-variant opacity-60 text-center py-4">Scanning…</div>}

          {/* Filter tabs */}
          {scannedOps.length > 0 && (
            <div className="flex gap-1 mb-3 flex-wrap">
              {(['all', 'Waiting', 'Ready', 'Done'] as const).map((f) => {
                const count = f === 'all' ? scannedOps.length : scannedOps.filter((o) => o.state === f).length;
                return (
                  <button key={f} className={`tab-btn text-[10px] ${opFilter === f ? 'tab-btn-active' : ''}`}
                    onClick={() => setOpFilter(f)}>
                    {f === 'all' ? 'All' : f} ({count})
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            {scannedOps
              .filter((op) => opFilter === 'all' || op.state === opFilter)
              .sort((a, b) => {
                // Waiting first, then Ready, then Done; within Waiting sort by ETA (soonest first)
                const order: Record<string, number> = { Waiting: 0, Ready: 1, Done: 2, Unset: 3 };
                const diff = (order[a.state] ?? 9) - (order[b.state] ?? 9);
                if (diff !== 0) return diff;
                if (a.eta && b.eta) return a.eta.localeCompare(b.eta);
                return 0;
              })
              .map((op) => {
              const decoded = decodeCalldata(op.data);
              return (
                <div key={op.id} className="bg-surface-container rounded-lg border border-outline-variant/10 overflow-hidden">
                  {/* Header: decoded function name or raw hash */}
                  <div className="px-3 pt-3 pb-2">
                    {decoded ? (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-primary font-semibold">{decoded.fn}()</span>
                        <span className="text-[9px] text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded">{decoded.contract}</span>
                      </div>
                    ) : (
                      <div className="font-mono text-[11px] text-on-surface mb-1">{op.data.slice(0, 10)}</div>
                    )}
                    <div className="font-mono text-[10px] text-on-surface-variant opacity-60">
                      {op.id.slice(0, 14)}…{op.id.slice(-6)}
                    </div>
                    {op.eta && <div className="text-[10px] text-tertiary mt-1">{op.eta}</div>}
                  </div>

                  {/* Decoded args preview */}
                  {decoded && Object.keys(decoded.args).length > 0 && (
                    <div className="px-3 pb-2">
                      {Object.entries(decoded.args).slice(0, 3).map(([k, v]) => (
                        <div key={k} className="font-mono text-[10px] text-on-surface-variant truncate">
                          <span className="text-on-surface">{k}</span>: {v.length > 20 ? v.slice(0, 20) + '…' : v}
                        </div>
                      ))}
                      {Object.keys(decoded.args).length > 3 && (
                        <div className="text-[10px] text-on-surface-variant opacity-50">+{Object.keys(decoded.args).length - 3} more</div>
                      )}
                    </div>
                  )}

                  {/* Footer: status + actions */}
                  <div className="flex items-center gap-2 px-3 py-2 border-t border-outline-variant/10 bg-surface/50">
                    <StateBadge state={op.state} />
                    <div className="flex-1" />
                    <a href={explorerTx(op.txHash)} target="_blank" rel="noreferrer"
                      className="btn btn-sm btn-ghost text-[10px]">↗ Explorer</a>
                    <button className="btn btn-sm"
                      onClick={() => {
                        setLookupHash(op.id);
                        setDerivedTarget(op.target);
                        setDerivedCalldata(op.data);
                        setDerivedPredecessor(op.predecessor);
                        setDerivedSalt(op.salt);
                        setOpState(op.state);
                        setOpEta(op.eta);
                      }}>Load</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

    </div>
  );
}

// ── Role Management Component ──────────────────────────────────────────────

const ROLE_NAMES = ['PROPOSER', 'EXECUTOR', 'CANCELLER', 'ADMIN'] as const;
type RoleName = typeof ROLE_NAMES[number];
const ROLE_COLORS: Record<RoleName, string> = {
  PROPOSER: 'bg-primary/10 text-primary border-primary/20',
  EXECUTOR: 'bg-secondary/10 text-secondary border-secondary/20',
  CANCELLER: 'bg-error/10 text-error border-error/20',
  ADMIN: 'bg-tertiary/10 text-tertiary border-tertiary/20',
};

function RoleManagement({ timelockAddr, ops, evm, wrongChain, chainName, switchNetwork }: {
  timelockAddr: string;
  ops: ReturnType<typeof useTimelockOps>;
  evm: { isConnected: boolean; address: string | null; provider: import('ethers').BrowserProvider | null; connect: () => Promise<void> };
  wrongChain: boolean;
  chainName: string;
  switchNetwork: () => void;
}): JSX.Element {
  const [walletRoles, setWalletRoles] = useState<Record<RoleName, boolean> | null>(null);
  const [roleHashes, setRoleHashes] = useState<Record<string, string> | null>(null);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Grant/revoke state
  const [grantRoleName, setGrantRoleName] = useState<RoleName>('PROPOSER');
  const [grantAddr, setGrantAddr] = useState('');
  const [grantTx, setGrantTx] = useState<TxState>({ status: 'idle' });
  const [revokeMode, setRevokeMode] = useState(false);

  async function handleLoadRoles() {
    if (!timelockAddr || !evm.address) return;
    setLoadingRoles(true);
    setRoleError(null);
    try {
      const [roles, hashes] = await Promise.all([
        ops.checkRoles(timelockAddr, evm.address, evm.provider ?? undefined),
        ops.getRoleHashes(timelockAddr, evm.provider ?? undefined),
      ]);
      setWalletRoles({
        PROPOSER: roles.proposer,
        EXECUTOR: roles.executor,
        CANCELLER: roles.canceller,
        ADMIN: roles.admin,
      });
      setRoleHashes(hashes);
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRoles(false);
    }
  }

  async function handleGrantOrRevoke() {
    if (!timelockAddr || !roleHashes || !grantAddr) return;
    const roleKey = grantRoleName.toLowerCase() as 'proposer' | 'executor' | 'canceller' | 'admin';
    const hash = roleHashes[roleKey];
    if (!hash) return;
    setGrantTx({ status: 'pending' });
    const result = revokeMode
      ? await ops.revokeRole(timelockAddr, hash, grantAddr)
      : await ops.grantRole(timelockAddr, hash, grantAddr);
    setGrantTx(result);
    if (result.status === 'success') void handleLoadRoles();
  }

  return (
    <Section icon="admin_panel_settings" title="Role Management" subtitle="Check and manage Timelock roles"
      actions={
        <button className="btn btn-sm" onClick={handleLoadRoles}
          disabled={loadingRoles || !timelockAddr || !evm.isConnected}>
          {loadingRoles ? 'Loading…' : 'Check Roles'}
        </button>
      }>
      {roleError && <div className="text-xs text-error mb-3">{roleError}</div>}


      {walletRoles && (
        <>
          <div className="flex gap-2 flex-wrap mb-4">
            {ROLE_NAMES.map((role) => (
              <span key={role} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold border ${walletRoles[role] ? ROLE_COLORS[role] : 'bg-surface-container text-on-surface-variant/40 border-outline-variant/10'}`}>
                {walletRoles[role] ? '✓' : '✗'} {role}
              </span>
            ))}
          </div>
          <div className="text-[11px] text-on-surface-variant mb-4">
            You can: {[
              walletRoles.PROPOSER && 'schedule',
              walletRoles.EXECUTOR && 'execute',
              walletRoles.CANCELLER && 'cancel',
              walletRoles.ADMIN && 'grant/revoke roles',
            ].filter(Boolean).join(', ') || 'nothing (no roles)'}
          </div>

          {walletRoles.ADMIN && (
            <div className="bg-surface-container rounded-lg p-4 border border-outline-variant/10">
              <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-2">
                {revokeMode ? 'Revoke' : 'Grant'} role
              </div>
              <div className="flex gap-2 items-end flex-wrap">
                <div>
                  <select className="input text-xs" value={grantRoleName} onChange={(e) => setGrantRoleName(e.target.value as RoleName)}>
                    {ROLE_NAMES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <input className="input" placeholder="Account address (0x…)" value={grantAddr}
                    onChange={(e) => setGrantAddr(e.target.value)} spellCheck={false} />
                </div>
                {wrongChain ? (
                  <SwitchChainButton chainName={chainName} onSwitch={switchNetwork} />
                ) : (
                  <button className={`btn ${revokeMode ? 'btn-danger' : 'btn-primary'}`}
                    disabled={!grantAddr || grantTx.status === 'pending'}
                    onClick={handleGrantOrRevoke}>
                    {revokeMode ? 'Revoke' : 'Grant'}
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => setRevokeMode((v) => !v)}>
                  {revokeMode ? 'Switch to Grant' : 'Switch to Revoke'}
                </button>
              </div>
              <div className="mt-2"><TxStatus state={grantTx} /></div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
