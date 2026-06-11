import { useState, useMemo, useEffect } from 'react';
import { JsonRpcProvider, Interface, FunctionFragment, keccak256, toUtf8Bytes } from 'ethers';
import TimelockControllerABI from '@/abis/evm/TimelockController.json';
import timelockTarget from '@/config/timelockTarget.json';
import timelockTargetStarknet from '@/config/timelockTargetStarknet.json';
import { useWallet } from '@/context/WalletContext';
import { useTimelockOps } from '@/hooks/useTimelockOps';
import { useCairoTimelock } from '@/hooks/useCairoTimelock';
import { TxStatus } from '@/components/TxStatus';
import { Section } from '@/components/Section';
import { SwitchChainButton } from '@/components/ChainSwitch';
import { CopyButton } from '@/components/CopyButton';
import { AddressPill } from '@/components/AddressPill';
import { StickyAction } from '@/components/StickyAction';
import { Spinner } from '@/components/Spinner';
import { Icon, ICONS } from '@/components/Icon';
import { useToast } from '@/context/ToastContext';
import { CONTRACTS, ARBISCAN_API_KEY, STARKNET_TESTNET, STARKNET_MAINNET } from '@/config/chains';
import { getStarknetMainnetRpc, getStarknetSepoliaRpc } from '@/pages/Settings';
import { hashOperation as localHashOp, formatDelay, randomSalt, formatCountdown, isFelt252 } from '@/utils/timelock';
import OFTAdapterABI from '@/abis/evm/OFTAdapter.json';
import OFTABI from '@/abis/evm/OFT.json';
import EndpointV2ABI from '@/abis/evm/EndpointV2.json';
import ERC20ABI from '@/abis/evm/ERC20.json';
import AccessControlABI from '@/abis/evm/AccessControl.json';
import TimelockCairoABI from '@/abis/svm/TimelockController.json';
import OFTCairoABI from '@/abis/svm/OFT.json';
import OFTAdapterCairoABI from '@/abis/svm/OFTAdapter.json';
import EndpointV2CairoABI from '@/abis/svm/EndpointV2.json';
import AccessControlCairoABI from '@/abis/svm/AccessControl.json';
import {
  extractFunctions as extractStarkFunctions,
  selectorFromName,
  encodeCalldata as encodeStarkArgs,
  argPlaceholder as starkArgPlaceholder,
  decodeStarknetCall,
  toFeltHex,
} from '@/utils/starknetTimelock';
import { getAllStarknetEvents, eventKey } from '@/utils/starknetEvents';
import { RpcProvider as StarkRpcProvider } from 'starknet';
import type { TxState, OperationState } from '@/types';
import { VaultState } from '@/types';

// ── Parse EVM timelockTarget.json once ──────────────────────────────────────
const TARGET_IFACE = new Interface(timelockTarget.abi);
const EVM_WRITE_FUNCTIONS = TARGET_IFACE.fragments.filter(
  (f): f is FunctionFragment =>
    FunctionFragment.isFragment(f) &&
    f.stateMutability !== 'view' &&
    f.stateMutability !== 'pure',
);

// ── Parse Starknet timelockTargetStarknet.json once ─────────────────────────
const STARK_TARGET_ABI = timelockTargetStarknet.abi as unknown[];
const STARK_WRITE_FUNCTIONS = extractStarkFunctions(STARK_TARGET_ABI, 'external');

// ── Unified UI function shape for the picker ────────────────────────────────
interface UiInput { name: string; type: string }
interface UiFunction { name: string; inputs: UiInput[] }

const EVM_UI_FNS: UiFunction[] = EVM_WRITE_FUNCTIONS.map((f) => ({
  name: f.name,
  inputs: f.inputs.map((i) => ({ name: i.name ?? '', type: i.type })),
}));
const STARK_UI_FNS: UiFunction[] = STARK_WRITE_FUNCTIONS.map((f) => ({
  name: f.name,
  inputs: f.inputs.map((i) => ({ name: i.name, type: i.type })),
}));

function parseArg(value: string, type: string): unknown {
  if (type === 'bool') return value === 'true' || value === '1';
  if (type.startsWith('uint') || type.startsWith('int')) return BigInt(value || '0');
  return value; // address, bytes*, string
}

// ── Calldata decoders — try multiple ABIs ───────────────────────────────────
const DECODE_IFACES = [
  { name: 'Target',          iface: TARGET_IFACE },
  { name: 'TimelockController', iface: new Interface(TimelockControllerABI) },
  { name: 'OFTAdapter',      iface: new Interface(OFTAdapterABI) },
  { name: 'OFT',             iface: new Interface(OFTABI) },
  { name: 'EndpointV2',      iface: new Interface(EndpointV2ABI) },
  { name: 'ERC20',           iface: new Interface(ERC20ABI) },
  { name: 'AccessControl',   iface: new Interface(AccessControlABI) },
];

const STARK_DECODE_ABIS = [
  { name: 'Target',             abi: STARK_TARGET_ABI },
  { name: 'TimelockController', abi: TimelockCairoABI as unknown[] },
  { name: 'OFT',                abi: OFTCairoABI as unknown[] },
  { name: 'OFTAdapter',         abi: OFTAdapterCairoABI as unknown[] },
  { name: 'EndpointV2',         abi: EndpointV2CairoABI as unknown[] },
  { name: 'AccessControl',      abi: AccessControlCairoABI as unknown[] },
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
  /** EVM hex calldata. Empty for Starknet ops; use cairoSelector / cairoCalldata instead. */
  data: string;
  predecessor: string;
  salt: string;
  state: OperationState;
  eta: string | null;
  /** Unix seconds when a Waiting op becomes Ready. Drives the live countdown. */
  readyAt: number | null;
  txHash: string;
  kind: 'evm' | 'starknet';
  /** Starknet only: selector of the inner call. */
  cairoSelector?: string;
  /** Starknet only: felt252 calldata for the inner call. */
  cairoCalldata?: string[];
}

/** Re-renders on a shared 1s tick so countdowns stay current without per-op timers. */
function useNow(intervalMs = 1000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

/** Live "Ready in …" countdown that ticks every second and flips to "Ready" at zero. */
function LiveCountdown({ readyAt, className }: { readyAt: number; className?: string }): JSX.Element {
  useNow(1000);
  const remaining = readyAt - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return <span className={className}>Ready now</span>;
  return <span className={className}>{formatCountdown(readyAt, true)}</span>;
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

/** Resolve the Starknet chain entry with the user's RPC override from Settings applied at call time. */
function resolveStarkChain(isTestnet: boolean): { id: string; name: string; rpc: string; explorer: string } {
  if (isTestnet) {
    return { id: 'SN_SEPOLIA', name: 'Starknet Sepolia', rpc: getStarknetSepoliaRpc(STARKNET_TESTNET.rpc), explorer: 'sepolia.voyager.online' };
  }
  return { id: 'SN_MAIN', name: 'Starknet Mainnet', rpc: getStarknetMainnetRpc(STARKNET_MAINNET.rpc), explorer: 'voyager.online' };
}

/** Fire a toast each time `tx` transitions from pending → success/error. */
function useTxToast(label: string, tx: TxState, toast: ReturnType<typeof useToast>): void {
  const last = useMemo(() => ({ status: tx.status }), [tx.status]);
  useEffect(() => {
    if (last.status === 'success') {
      const h = (tx as { hash?: string }).hash;
      toast.success(`${label} confirmed`, h ? `${h.slice(0, 10)}…${h.slice(-8)}` : undefined);
    } else if (last.status === 'error') {
      const m = (tx as { message?: string }).message ?? 'unknown error';
      toast.error(`${label} failed`, m.length > 240 ? m.slice(0, 240) + '…' : m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.status]);
}

export function Timelock(): JSX.Element {
  const { evm, stark } = useWallet();
  const ops = useTimelockOps(evm.signer);
  const cairoOps = useCairoTimelock(stark.account);
  const [chainType, setChainType] = useState<ChainType>('evm');

  // Testnet/Mainnet toggle — filters EVM chains and auto-sets Starknet chain
  const [isTestnet, setIsTestnet] = useState(true);
  const filteredChains = TIMELOCK_CHAINS.filter((c) => c.isTestnet === isTestnet);
  const starkChain = resolveStarkChain(isTestnet);

  // EVM chain selection — defaults to the connected wallet's chain so navigating between pages
  // keeps you on it. An explicit in-page pick (this session) wins; the persisted localStorage
  // value is only the no-wallet fallback for fresh loads.
  const [persistedChainId] = useState<number>(() => {
    try { const s = localStorage.getItem('ozlz_timelock_chain'); return s ? Number(s) : 421614; } catch { return 421614; }
  });
  const [pickedChainId, setPickedChainId] = useState<number | null>(null);
  const walletChainId = evm.isConnected && filteredChains.some((c) => c.id === evm.chainId) ? evm.chainId : null;
  const activeChainId = pickedChainId ?? walletChainId ?? persistedChainId;
  function selectChain(id: number) {
    setPickedChainId(id);
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
  const [minDelayError, setMinDelayError] = useState<string | null>(null);

  // ── Dynamic function picker (unified EVM / Starknet) ──────────────────────
  const uiFunctions: UiFunction[] = chainType === 'starknet' ? STARK_UI_FNS : EVM_UI_FNS;
  const [selectedFn, setSelectedFn] = useState<string>(() => uiFunctions[0]?.name ?? '');

  // When chainType flips, reset selection to the first fn of the new list
  useEffect(() => {
    setSelectedFn(uiFunctions[0]?.name ?? '');
  }, [chainType]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentFn = uiFunctions.find((f) => f.name === selectedFn) ?? null;

  const [fnArgs, setFnArgs] = useState<string[]>(() =>
    uiFunctions[0] ? uiFunctions[0].inputs.map(() => '') : [],
  );
  // Per-arg toggle: hash the value as keccak256(utf8(string)) instead of treating it as raw
  // bytes32. Defaults ON for key-named bytes32 args, e.g. setContractAddress(keccak256("Hub"), …).
  const [argKeccak, setArgKeccak] = useState<boolean[]>([]);
  useEffect(() => {
    setFnArgs(currentFn ? currentFn.inputs.map(() => '') : []);
    setArgKeccak(currentFn
      ? currentFn.inputs.map((inp) => inp.type === 'bytes32' && /key/i.test(inp.name))
      : []);
  }, [selectedFn]); // eslint-disable-line react-hooks/exhaustive-deps

  function setArg(i: number, value: string) {
    setFnArgs((prev) => { const next = [...prev]; next[i] = value; return next; });
  }
  function setArgKeccakAt(i: number, on: boolean) {
    setArgKeccak((prev) => { const next = [...prev]; next[i] = on; return next; });
  }
  /** Resolve a bytes32 arg's raw value, applying keccak256(utf8) when its toggle is on. */
  function resolveBytes32(value: string, i: number): string {
    return argKeccak[i] ? keccak256(toUtf8Bytes(value)) : value;
  }

  // ── Calldata encoding ─────────────────────────────────────────────────────
  // EVM: hex string.  Starknet: { selector, felts[] }.  One is active at a time.
  const { calldata, calldataError, starkSelector, starkCalldata } = useMemo(() => {
    if (!currentFn) return { calldata: null, calldataError: 'No function selected', starkSelector: null, starkCalldata: null };

    if (chainType === 'starknet') {
      const fn = STARK_WRITE_FUNCTIONS.find((f) => f.name === currentFn.name);
      if (!fn) return {
        calldata: null, starkSelector: null, starkCalldata: null,
        calldataError: STARK_UI_FNS.length === 0
          ? 'No functions in timelockTargetStarknet.json — populate the abi field.'
          : 'Function not found in Starknet target ABI',
      };
      // Don't encode until all args are filled (avoid noisy errors while typing)
      if (fnArgs.some((v, i) => v === '' && !fn.inputs[i]?.type.endsWith('::ByteArray'))) {
        return { calldata: null, calldataError: null, starkSelector: null, starkCalldata: null };
      }
      try {
        const felts = encodeStarkArgs(fn, fnArgs);
        const selector = selectorFromName(fn.name);
        return { calldata: null, calldataError: null, starkSelector: selector, starkCalldata: felts };
      } catch (e) {
        return { calldata: null, starkSelector: null, starkCalldata: null, calldataError: e instanceof Error ? e.message : String(e) };
      }
    }

    // EVM branch
    if (fnArgs.some((v) => v === '' && currentFn.inputs[fnArgs.indexOf(v)]?.type !== 'string'))
      return { calldata: null, calldataError: null, starkSelector: null, starkCalldata: null };
    try {
      const parsed = fnArgs.map((v, i) => {
        const t = currentFn.inputs[i].type;
        return t === 'bytes32' ? resolveBytes32(v, i) : parseArg(v, t);
      });
      const data = TARGET_IFACE.encodeFunctionData(currentFn.name, parsed);
      return { calldata: data, calldataError: null, starkSelector: null, starkCalldata: null };
    } catch (e) {
      return { calldata: null, calldataError: e instanceof Error ? e.message : String(e), starkSelector: null, starkCalldata: null };
    }
  }, [currentFn, fnArgs, argKeccak, chainType]);

  // ── Timelock params ───────────────────────────────────────────────────────
  const [delay,       setDelay]       = useState('172800');
  const [salt,        setSalt]        = useState(randomSalt());
  const [predecessor, setPredecessor] = useState('0x0000000000000000000000000000000000000000000000000000000000000000');

  // ── EVM: remember last-good calldata for execute after the form clears ────
  const [lastCalldata, setLastCalldata] = useState<string | null>(null);
  useEffect(() => { if (calldata) setLastCalldata(calldata); }, [calldata]);
  const execCalldata = calldata ?? lastCalldata;

  // ── Starknet: remember last-good selector + calldata felts ────────────────
  const [lastStarkSelector, setLastStarkSelector] = useState<string | null>(null);
  const [lastStarkCalldata, setLastStarkCalldata] = useState<string[] | null>(null);
  useEffect(() => { if (starkSelector) setLastStarkSelector(starkSelector); }, [starkSelector]);
  useEffect(() => { if (starkCalldata) setLastStarkCalldata(starkCalldata); }, [starkCalldata]);
  const execStarkSelector = starkSelector ?? lastStarkSelector;
  const execStarkCalldata = starkCalldata ?? lastStarkCalldata;

  // ── Operation hash ────────────────────────────────────────────────────────
  const evmFreshOpHash = chainType === 'evm' && execCalldata && timelockAddr
    ? localHashOp(timelockAddr, 0n, execCalldata, predecessor, salt)
    : null;

  const [starkOpHash, setStarkOpHash] = useState<string | null>(null);
  const [opHashError, setOpHashError] = useState<string | null>(null);
  const starkCalldataKey = execStarkCalldata?.join(',') ?? '';
  useEffect(() => {
    if (chainType !== 'starknet') { setStarkOpHash(null); setOpHashError(null); return; }
    if (!timelockAddr || !execStarkSelector || !execStarkCalldata) { setStarkOpHash(null); setOpHashError(null); return; }
    let cancelled = false;
    setOpHashError(null);
    const timer = setTimeout(async () => {
      try {
        const h = await cairoOps.hashOperation(timelockAddr, timelockAddr, execStarkSelector, execStarkCalldata, predecessor, salt, starkChain.rpc);
        if (!cancelled) setStarkOpHash(h);
      } catch (e) {
        if (!cancelled) { setStarkOpHash(null); setOpHashError(e instanceof Error ? e.message : String(e)); }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainType, timelockAddr, execStarkSelector, starkCalldataKey, predecessor, salt, starkChain.rpc]);

  const freshOpHash = chainType === 'starknet' ? starkOpHash : evmFreshOpHash;
  const [lastOpHash, setLastOpHash] = useState<string | null>(null);
  useEffect(() => { if (freshOpHash) setLastOpHash(freshOpHash); }, [freshOpHash]);
  const opHash = freshOpHash ?? lastOpHash;

  // ── Salt / predecessor felt252 validation (Starknet only) ────────────────
  const saltInvalidForStarknet = chainType === 'starknet' && !!salt.trim() && !isFelt252(salt);
  const predecessorInvalidForStarknet = chainType === 'starknet' && !!predecessor.trim() && !isFelt252(predecessor);

  // ── Check op state ────────────────────────────────────────────────────────
  const [lookupHash,  setLookupHash]  = useState('');
  const [opState,     setOpState]     = useState<OperationState | null>(null);
  const [opEta,       setOpEta]       = useState<string | null>(null);
  const [opReadyAt,   setOpReadyAt]   = useState<number | null>(null);
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

  const toast = useToast();
  useTxToast('Schedule', scheduleTx, toast);
  useTxToast('Execute',  executeTx,  toast);
  useTxToast('Cancel',   cancelTx,   toast);

  const [scannedOps,   setScannedOps]   = useState<ScannedOp[]>([]);
  const [scanning,     setScanning]     = useState(false);
  const [scanProgress, setScanProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [scanError,    setScanError]    = useState<string | null>(null);
  const [scanFromBlock, setScanFromBlock] = useState('');
  const [opFilter, setOpFilter] = useState<'all' | 'Waiting' | 'Ready' | 'Done'>('all');

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function loadMinDelay(): Promise<void> {
    if (!timelockAddr) return;
    setMinDelayError(null);
    try {
      const d = chainType === 'starknet'
        ? await cairoOps.getMinDelay(timelockAddr, starkChain.rpc)
        : await ops.getMinDelay(timelockAddr, evm.provider ?? undefined);
      setMinDelay(formatDelay(Number(d)));
      setDelay(String(d));
    } catch (e) {
      setMinDelay('');
      setMinDelayError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSchedule(): Promise<void> {
    if (!timelockAddr) return;
    setScheduleTx({ status: 'pending' });
    if (chainType === 'starknet') {
      if (!starkSelector || !starkCalldata) { setScheduleTx({ status: 'error', message: 'Starknet calldata not ready' }); return; }
      // Target = timelock itself — same pattern as EVM (admin gateway)
      const result = await cairoOps.schedule(timelockAddr, timelockAddr, starkSelector, starkCalldata, toFeltHex(predecessor), toFeltHex(salt), Number(delay));
      setScheduleTx(result);
    } else {
      if (!calldata) { setScheduleTx({ status: 'error', message: 'EVM calldata not ready' }); return; }
      const result = await ops.schedule(timelockAddr, 0n, calldata, predecessor, salt, BigInt(delay));
      setScheduleTx(result);
    }
  }

  async function handleLookup(): Promise<void> {
    if (!timelockAddr || !lookupHash) return;
    setOpState(null); setOpEta(null); setOpReadyAt(null); setLookupDebug(null); setLookupError(null);
    try {
      if (chainType === 'starknet') {
        const id = toFeltHex(lookupHash);
        const state = await cairoOps.getOperationState(timelockAddr, id, starkChain.rpc);
        setOpState(state);
        if (state === 'Waiting') {
          const ts = await cairoOps.getTimestamp(timelockAddr, id, starkChain.rpc);
          setOpEta(formatCountdown(Number(ts)));
          setOpReadyAt(Number(ts));
        }
        setLookupDebug(`contract: ${timelockAddr} | id: ${id.slice(0, 14)}… | chain: ${starkChain.name}`);
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
        if (state === 'Waiting') { setOpEta(formatCountdown(tsNum)); setOpReadyAt(tsNum); }
      }
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleExecute(): Promise<void> {
    const target = derivedTarget ?? timelockAddr;
    const pred = derivedPredecessor ?? predecessor;
    const s = derivedSalt ?? salt;
    if (!target) return;
    setExecuteTx({ status: 'pending' });
    if (chainType === 'starknet') {
      if (!execStarkSelector || !execStarkCalldata) { setExecuteTx({ status: 'error', message: 'Fill in the scheduled function form to execute.' }); return; }
      const result = await cairoOps.execute(timelockAddr, target, execStarkSelector, execStarkCalldata, toFeltHex(pred), toFeltHex(s));
      setExecuteTx(result);
    } else {
      const data = derivedCalldata ?? execCalldata;
      if (!data) { setExecuteTx({ status: 'error', message: 'EVM calldata not ready' }); return; }
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
      setCancelTx(await cairoOps.cancel(timelockAddr, toFeltHex(lookupHash)));
    } else {
      setCancelTx(await ops.cancel(timelockAddr, lookupHash));
    }
  }

  async function handleScan(): Promise<void> {
    if (!timelockAddr) return;
    setScanning(true); setScanError(null); setScannedOps([]);
    setScanProgress({ label: 'Fetching events…', done: 0, total: 0 });
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
      setScanProgress({ label: 'Resolving operations', done: 0, total: active.length });
      const results: ScannedOp[] = await Promise.all(active.map(async (op) => {
        const ts = await ops.getTimestamp(timelockAddr, op.id, wp);
        const tsNum = Number(ts);
        let state: OperationState;
        if (tsNum === 0) state = 'Unset';
        else if (tsNum === 1) state = 'Done';
        else if (tsNum <= now) state = 'Ready';
        else state = 'Waiting';
        setScanProgress((p) => p ? { ...p, done: p.done + 1 } : p);
        return { ...op, kind: 'evm' as const, state, eta: state === 'Waiting' ? formatCountdown(tsNum) : null, readyAt: state === 'Waiting' ? tsNum : null };
      }));
      setScannedOps(results);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  async function handleStarknetScan(): Promise<void> {
    if (!timelockAddr) return;
    setScanning(true); setScanError(null); setScannedOps([]);
    setScanProgress({ label: 'Fetching events…', done: 0, total: 0 });
    try {
      // Resolve from-block: user input first, otherwise (latest - 100k blocks).
      let fromBlock: number | undefined;
      const trimmed = scanFromBlock.trim();
      if (trimmed) {
        const n = Number(trimmed);
        if (!Number.isInteger(n) || n < 0) throw new Error('From block must be a non-negative integer');
        fromBlock = n;
      } else {
        try {
          const provider = new StarkRpcProvider({ nodeUrl: starkChain.rpc });
          const latest = await provider.getBlockLatestAccepted();
          fromBlock = Math.max(0, latest.block_number - 100000);
        } catch { /* leave undefined → node default */ }
      }

      // Fetch events in one paginated pass (4 names OR-matched on key[0]).
      const events = await getAllStarknetEvents(
        starkChain.rpc,
        timelockAddr,
        ['CallScheduled', 'CallExecuted', 'CallSalt', 'Cancelled'],
        fromBlock,
      );

      // Bucket by event type using the selector at keys[0].
      const SCHEDULED = eventKey('CallScheduled');
      const EXECUTED  = eventKey('CallExecuted');
      const SALT      = eventKey('CallSalt');
      const CANCELLED = eventKey('Cancelled');

      const norm = (h: string): string => '0x' + BigInt(h).toString(16);

      const scheduled: typeof events = [];
      const executed:  typeof events = [];
      const saltLogs:  typeof events = [];
      const cancelled: typeof events = [];
      for (const ev of events) {
        const k0 = norm(ev.keys[0]);
        if (k0 === norm(SCHEDULED)) scheduled.push(ev);
        else if (k0 === norm(EXECUTED))  executed.push(ev);
        else if (k0 === norm(SALT))      saltLogs.push(ev);
        else if (k0 === norm(CANCELLED)) cancelled.push(ev);
      }

      const doneIds = new Set<string>();
      for (const ev of executed)  doneIds.add(norm(ev.keys[1]));
      for (const ev of cancelled) doneIds.add(norm(ev.keys[1]));

      const saltMap = new Map<string, string>();
      for (const ev of saltLogs) {
        // CallSalt: keys = [selector, id], data = [salt]
        const id = norm(ev.keys[1]);
        if (ev.data[0]) saltMap.set(id, norm(ev.data[0]));
      }

      // CallScheduled layout (OZ Cairo Timelock):
      //   keys = [selector, id, index]
      //   data = [call.to, call.selector, calldata.len, ...calldata, predecessor, delay]
      const seen = new Set<string>();
      const active: { id: string; target: string; predecessor: string; salt: string; txHash: string;
                      cairoSelector: string; cairoCalldata: string[] }[] = [];
      for (const ev of scheduled) {
        const id = norm(ev.keys[1]);
        const index = Number(BigInt(ev.keys[2] ?? '0x0'));
        if (index !== 0 || seen.has(id) || doneIds.has(id)) continue;
        seen.add(id);
        try {
          const d = ev.data;
          const target = norm(d[0]);
          const innerSelector = norm(d[1]);
          const calldataLen = Number(BigInt(d[2]));
          const calldata = d.slice(3, 3 + calldataLen).map(norm);
          const predecessor = norm(d[3 + calldataLen] ?? '0x0');
          // delay (one felt for u64) is at d[3+calldataLen+1]; not stored.
          active.push({
            id, target, predecessor,
            salt: saltMap.get(id) ?? '0x0',
            txHash: ev.transaction_hash,
            cairoSelector: innerSelector,
            cairoCalldata: calldata,
          });
        } catch { /* skip malformed event */ }
      }

      // Resolve state via on-chain getTimestamp, mirroring the EVM path.
      const now = Math.floor(Date.now() / 1000);
      setScanProgress({ label: 'Resolving operations', done: 0, total: active.length });
      const results: ScannedOp[] = await Promise.all(active.map(async (op) => {
        let state: OperationState = 'Unset';
        let eta: string | null = null;
        let readyAt: number | null = null;
        try {
          const ts = await cairoOps.getTimestamp(timelockAddr, op.id, starkChain.rpc);
          const tsNum = Number(ts);
          if (tsNum === 0) state = 'Unset';
          else if (tsNum === 1) state = 'Done';
          else if (tsNum <= now) state = 'Ready';
          else { state = 'Waiting'; eta = formatCountdown(tsNum); readyAt = tsNum; }
        } catch { /* leave Unset */ }
        setScanProgress((p) => p ? { ...p, done: p.done + 1 } : p);
        return {
          id: op.id, target: op.target, data: '', predecessor: op.predecessor, salt: op.salt,
          txHash: op.txHash, kind: 'starknet' as const,
          cairoSelector: op.cairoSelector, cairoCalldata: op.cairoCalldata,
          state, eta, readyAt,
        };
      }));
      setScannedOps(results);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  function handleScanClick(): void {
    if (chainType === 'starknet') void handleStarknetScan();
    else void handleScan();
  }

  const explorerTx = (hash: string) =>
    chainType === 'starknet'
      ? `https://${starkChain.explorer}/tx/${hash}`
      : `https://${selectedChain.explorer}/tx/${hash}`;

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
          {minDelayError && (
            <div className="mt-3 text-xs text-error break-all">Error: {minDelayError}</div>
          )}
        </Section>

        {/* Schedule Operation */}
        <Section icon="add_circle" title="Schedule Operation" subtitle="Encode and schedule a timelock operation">

          {uiFunctions.length === 0 ? (
            <div className="text-xs text-on-surface-variant subpanel rounded-lg p-4">
              {chainType === 'starknet'
                ? <>No write functions found in <span className="font-mono">src/config/timelockTargetStarknet.json</span>. Populate the <span className="font-mono">abi</span> field with your Cairo contract's ABI.</>
                : <>No write functions found in <span className="font-mono">src/config/timelockTarget.json</span>. Replace the ABI with your contract's ABI.</>}
            </div>
          ) : (
            <>
              <div className="mb-4">
                <div className="label">Function</div>
                <select className="input" value={selectedFn} onChange={(e) => setSelectedFn(e.target.value)}>
                  {uiFunctions.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </select>
              </div>

              {/* Dynamic inputs */}
              {currentFn && currentFn.inputs.length > 0 && (
                <div className="mb-4 space-y-3">
                  {currentFn.inputs.map((input, i) => (
                    <div key={i}>
                      <div className="label">
                        {input.name || `arg${i}`}
                        <span className="ml-1.5 normal-case text-primary/60 font-normal">({input.type})</span>
                      </div>
                      {chainType === 'evm' && selectedFn === 'setVaultState' && input.name === 'state' ? (
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
                      ) : chainType === 'evm' && input.type === 'bytes32' ? (
                        <>
                          <input
                            className="input"
                            value={fnArgs[i] ?? ''}
                            onChange={(e) => setArg(i, e.target.value)}
                            spellCheck={false}
                            placeholder={argKeccak[i] ? 'Hub' : '0x… (32 bytes)'}
                          />
                          <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-on-surface-variant cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="accent-primary"
                              checked={argKeccak[i] ?? false}
                              onChange={(e) => setArgKeccakAt(i, e.target.checked)}
                            />
                            Hash as keccak256(string)
                          </label>
                          {argKeccak[i] && (fnArgs[i] ?? '') !== '' && (
                            <div className="font-mono text-[10px] text-primary/70 mt-1 break-all">
                              = {(() => { try { return keccak256(toUtf8Bytes(fnArgs[i])); } catch { return '—'; } })()}
                            </div>
                          )}
                        </>
                      ) : (
                        <input
                          className="input"
                          value={fnArgs[i] ?? ''}
                          onChange={(e) => setArg(i, e.target.value)}
                          spellCheck={false}
                          placeholder={chainType === 'starknet'
                            ? starkArgPlaceholder(input.type)
                            : input.type === 'address' ? '0x…' : input.type.startsWith('uint') ? '0' : ''}
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
              <div className="label">Delay (seconds)</div>
              <input className="input" value={delay} onChange={(e) => setDelay(e.target.value)} />
            </div>
            <div className="flex-1">
              <div className="label">Salt</div>
              <div className="flex gap-2">
                <input
                  className={`input flex-1 ${saltInvalidForStarknet ? 'border-warn' : ''}`}
                  value={salt}
                  onChange={(e) => setSalt(e.target.value)}
                />
                <button className="btn" onClick={() => setSalt(randomSalt())}>Rand</button>
              </div>
              {saltInvalidForStarknet && (
                <div className="text-[11px] text-warn mt-1 leading-snug">
                  Out of felt252 range. Starknet requires salt &lt; 2<sup>252</sup>. Click <b>Rand</b> to regenerate.
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="label">Predecessor</div>
              <input
                className={`input ${predecessorInvalidForStarknet ? 'border-warn' : ''}`}
                value={predecessor}
                onChange={(e) => setPredecessor(e.target.value)}
              />
              {predecessorInvalidForStarknet && (
                <div className="text-[11px] text-warn mt-1 leading-snug">
                  Out of felt252 range. Use 0x0 if there's no predecessor.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4">
            {calldataError && (
              <div className="text-xs text-error mb-3">{calldataError}</div>
            )}
            {calldata && (
              <div className="mb-3">
                <div className="label">Encoded calldata</div>
                <div className="font-mono text-[11px] text-on-surface-variant break-all">{calldata}</div>
              </div>
            )}
            {chainType === 'starknet' && starkSelector && starkCalldata && (
              <div className="mb-3 space-y-2">
                <div>
                  <div className="label">Selector (sn_keccak)</div>
                  <div className="font-mono text-[11px] text-on-surface-variant break-all">{starkSelector}</div>
                </div>
                <div>
                  <div className="label">Calldata ({starkCalldata.length} felts)</div>
                  <div className="font-mono text-[11px] text-on-surface-variant break-all">[{starkCalldata.join(', ')}]</div>
                </div>
              </div>
            )}
            {chainType === 'starknet' && opHashError && (
              <div className="text-xs text-error mb-3 break-all">Op hash error: {opHashError}</div>
            )}
            {opHash && (
              <div className="bg-surface-container rounded-lg p-4 border border-primary/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Operation hash</span>
                  <div className="flex gap-2">
                    <CopyButton value={opHash} label="Copy" className="btn btn-sm" />
                    <button className="btn btn-sm" onClick={() => setLookupHash(opHash)}>Use for lookup</button>
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
              <StickyAction caption="Schedule operation" enabled={!opState}>
                <button className="btn btn-primary" onClick={handleSchedule}
                  disabled={chainType === 'starknet'
                    ? !stark.isConnected || !starkSelector || !starkCalldata || saltInvalidForStarknet || predecessorInvalidForStarknet
                    : !evm.isConnected || !calldata}>
                  Schedule{chainType === 'starknet' ? ' (Starknet)' : ''}
                </button>
              </StickyAction>
            )}
          </div>
          <div className="mt-3"><TxStatus state={scheduleTx} /></div>
        </Section>

        {/* Check Operation State */}
        <Section icon="search" title="Check Operation State" subtitle="Lookup operation status by hash">

          {chainType === 'evm' ? (
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
          ) : (
            <div className="bg-surface-container rounded-lg p-4 mb-5 text-[11px] text-on-surface-variant opacity-70">
              Derive-from-tx is EVM-only. Paste the operation id (felt252) directly below to look up a Starknet operation.
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <div className="label">
                Operation hash ({chainType === 'starknet' ? 'felt252' : 'bytes32'})
              </div>
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
                  {opReadyAt != null
                    ? <LiveCountdown readyAt={opReadyAt} className="text-xs text-tertiary font-mono tabular-nums" />
                    : opEta && <span className="text-xs text-on-surface-variant">{opEta}</span>}
                </div>
                {opState === 'Ready' && !wrongChain && (
                  <div className="flex flex-col gap-1">
                    <StickyAction caption="Execute operation" enabled={opState === 'Ready'}>
                      <button className="btn btn-primary" onClick={handleExecute}
                        disabled={chainType === 'starknet'
                          ? !stark.isConnected || (!execStarkSelector || !execStarkCalldata)
                          : !evm.isConnected || !derivedCalldata}>Execute</button>
                    </StickyAction>
                    {chainType === 'evm' && evm.isConnected && !derivedCalldata && <span className="text-[11px] text-on-surface-variant">Load an operation from the sidebar first</span>}
                    {chainType === 'starknet' && stark.isConnected && (!execStarkSelector || !execStarkCalldata) && <span className="text-[11px] text-on-surface-variant">Re-enter the scheduled function + args to execute</span>}
                  </div>
                )}
                {(opState === 'Waiting' || opState === 'Ready') && !wrongChain && (
                  <StickyAction caption="Cancel operation" enabled={opState === 'Waiting'}>
                    <button className="btn btn-danger"
                      onClick={handleCancel} disabled={chainType === 'starknet' ? !stark.isConnected : !evm.isConnected}>Cancel</button>
                  </StickyAction>
                )}
                {(opState === 'Ready' || opState === 'Waiting') && wrongChain && chainType === 'evm' && (
                  <SwitchChainButton chainName={selectedChain.name} onSwitch={() => evm.switchNetwork(selectedChain.id)} />
                )}
                {opState === 'Done' && <span className="text-xs text-on-surface-variant">Already executed — nothing to do</span>}
              </div>
              {chainType === 'evm' && derivedCalldata && (() => {
                const decoded = decodeCalldata(derivedCalldata);
                return (
                  <div className="text-[11px] leading-relaxed">
                    {decoded && (
                      <div className="subpanel rounded-lg p-3 mb-2">
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
              {chainType === 'starknet' && execStarkSelector && execStarkCalldata && (() => {
                const decoded = decodeStarknetCall(execStarkSelector, execStarkCalldata, STARK_DECODE_ABIS);
                return (
                  <div className="text-[11px] leading-relaxed">
                    {decoded ? (
                      <div className="subpanel rounded-lg p-3 mb-2">
                        <div className="label mb-1">Decoded</div>
                        <div className="text-primary font-semibold font-mono">{decoded.fn}()</div>
                        <div className="text-[10px] text-on-surface-variant mb-1">{decoded.contract}</div>
                        {Object.entries(decoded.args).map(([k, v]) => (
                          <div key={k} className="font-mono text-on-surface-variant">
                            <span className="text-on-surface">{k}</span>: {v}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="subpanel rounded-lg p-3 mb-2 text-on-surface-variant">
                        Unknown selector — not matched against loaded Cairo ABIs.
                      </div>
                    )}
                    <div className="font-mono text-on-surface-variant">
                      <div>target: {timelockAddr}</div>
                      <div>selector: {execStarkSelector}</div>
                      <div>predecessor: {predecessor}</div>
                      <div>salt: {salt}</div>
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
        <Section icon="list_alt" title="Operations" subtitle={scannedOps.length > 0 ? `${scannedOps.length} found` : 'Scan to discover'}
          actions={
            <button className="btn btn-sm" onClick={handleScanClick} disabled={scanning || !timelockAddr}>
              {scanning ? <Spinner size="sm" /> : 'Scan'}
            </button>
          }>
          <div className="mb-4">
            <div className="label">From block</div>
            <input className="input" placeholder="Auto (~100k blocks back)"
              value={scanFromBlock} onChange={(e) => setScanFromBlock(e.target.value)} />
          </div>

          {scanError && <div className="text-[11px] text-error mb-3">{scanError}</div>}
          {!scanning && scannedOps.length === 0 && !scanError && (
            <div className="text-xs text-on-surface-variant opacity-60 text-center py-4">Press Scan to search.</div>
          )}
          {scanning && (
            <div className="py-4">
              <div className="text-xs text-on-surface-variant flex items-center justify-center gap-1.5">
                <Spinner size="sm" />
                {scanProgress
                  ? <span>{scanProgress.label}{scanProgress.total > 0 ? ` ${scanProgress.done}/${scanProgress.total}` : '…'}</span>
                  : <span>Scanning…</span>}
              </div>
              {scanProgress && scanProgress.total > 0 && (
                <div className="mt-2 h-1 rounded-full bg-surface-container overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${Math.round((scanProgress.done / scanProgress.total) * 100)}%` }} />
                </div>
              )}
            </div>
          )}

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

          <div key={opFilter} className="space-y-2 tab-panel">
            {scannedOps
              .filter((op) => opFilter === 'all' || op.state === opFilter)
              .sort((a, b) => {
                // Waiting first, then Ready, then Done; within Waiting sort by ETA (soonest first)
                const order: Record<string, number> = { Waiting: 0, Ready: 1, Done: 2, Unset: 3 };
                const diff = (order[a.state] ?? 9) - (order[b.state] ?? 9);
                if (diff !== 0) return diff;
                // Within Waiting, soonest-ready first (numeric, not string compare).
                if (a.readyAt != null && b.readyAt != null) return a.readyAt - b.readyAt;
                return 0;
              })
              .map((op) => {
              const decoded = op.kind === 'starknet' && op.cairoSelector && op.cairoCalldata
                ? decodeStarknetCall(op.cairoSelector, op.cairoCalldata, STARK_DECODE_ABIS)
                : decodeCalldata(op.data);
              const headerFallback = op.kind === 'starknet'
                ? (op.cairoSelector ? `${op.cairoSelector.slice(0, 10)}…` : 'unknown')
                : op.data.slice(0, 10);
              return (
                <div key={op.id} className="subpanel rounded-lg overflow-hidden">
                  {/* Header: decoded function name or raw hash */}
                  <div className="px-3 pt-3 pb-2">
                    {decoded ? (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-primary font-semibold">{decoded.fn}()</span>
                        <span className="text-[9px] text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded">{decoded.contract}</span>
                      </div>
                    ) : (
                      <div className="font-mono text-[11px] text-on-surface mb-1">{headerFallback}</div>
                    )}
                    <AddressPill
                      address={op.id}
                      chain={op.kind === 'starknet' ? 'starknet' : null}
                      size="sm"
                      truncate={{ start: 12, end: 6 }}
                    />
                    {op.readyAt != null
                      ? <LiveCountdown readyAt={op.readyAt} className="block text-[10px] text-tertiary mt-1 font-mono tabular-nums" />
                      : op.eta && <div className="text-[10px] text-tertiary mt-1">{op.eta}</div>}
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
                      className="btn btn-sm btn-ghost text-[10px]"><Icon name={ICONS.external} size={13} /> Explorer</a>
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
            <div className="subpanel rounded-lg p-4">
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
