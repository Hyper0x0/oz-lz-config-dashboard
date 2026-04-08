import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useOFTWiring } from '@/hooks/useOFTWiring';
import { useLZChains } from '@/hooks/useLZChains';
import { useCairoOFT } from '@/hooks/useCairoOFT';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { TxStatus } from '@/components/TxStatus';
import { Section } from '@/components/Section';
import { CONTRACTS, STARKNET_TESTNET, STARKNET_MAINNET } from '@/config/chains';
import type { AnyChain, LZChain, StarknetChain } from '@/config/lzCatalog';
import { isStarknet, isEvm } from '@/config/lzCatalog';
import type { TxState } from '@/types';
import { decodeContractError } from '@/utils/decodeError';

type WiringMode = 'bridge-oft' | 'oft-oft';

function isAddr(s: string): boolean { return s.length > 2 && s !== '0x'; }

function toAnyEvm(c: LZChain): AnyChain { return { ...c, kind: 'evm' }; }
function starkChain(testnet: boolean): StarknetChain {
  const base = testnet ? STARKNET_TESTNET : STARKNET_MAINNET;
  try {
    const stored = localStorage.getItem('ozlz_rpc_overrides');
    if (stored) {
      const overrides = JSON.parse(stored) as { starknetMainnet?: string; starknetSepolia?: string };
      const override = testnet ? overrides.starknetSepolia : overrides.starknetMainnet;
      if (override?.trim()) return { kind: 'starknet', isTestnet: testnet, ...base, rpc: override.trim() };
    }
  } catch { /* ignore */ }
  return { kind: 'starknet', isTestnet: testnet, ...base };
}

export function OFTs(): JSX.Element {
  const { evm, stark } = useWallet();
  const { chains: evmChains, loading: chainsLoading, isTestnet, setIsTestnet } = useLZChains(true);
  const wiring = useOFTWiring(evm.signer);
  const cairo = useCairoOFT(stark.account);

  const [homeChain, setHomeChain] = useState<AnyChain | null>(null);
  const [remoteChain, setRemoteChain] = useState<AnyChain | null>(null);

  const defaultEvm0 = evmChains[0] ?? { eid: 0, chainId: 0, name: '', chainKey: '', endpoint: '', rpc: '', isTestnet: true } as LZChain;
  const defaultEvm1 = evmChains[1] ?? defaultEvm0;
  const home: AnyChain = homeChain ?? toAnyEvm(defaultEvm0);
  const remote: AnyChain = remoteChain ?? toAnyEvm(defaultEvm1);

  const [mode, setMode] = useState<WiringMode>('bridge-oft');
  const [detectedHome, setDetectedHome] = useState<'adapter' | 'oft' | null>(null);
  const [detecting, setDetecting] = useState(false);

  const [homeAddr, setHomeAddr] = useState(CONTRACTS.adapter);
  const [remoteAddr, setRemoteAddr] = useState(CONTRACTS.peer);
  const [evmUnderlyingToken, setEvmUnderlyingToken] = useState<string | null>(null);

  const hasStarknet = isStarknet(home) || isStarknet(remote);
  const evmHome: LZChain | null = isEvm(home) ? home : null;
  const starkHome = isStarknet(home) ? home : null;

  // Auto-detect Adapter vs OFT
  const detectTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    setDetectedHome(null);
    if (!isAddr(homeAddr)) return;
    clearTimeout(detectTimer.current);
    setDetecting(true);
    detectTimer.current = setTimeout(async () => {
      try {
        if (evmHome) {
          const t = await wiring.detectOFTType(homeAddr, evmHome.rpc).catch(() => null);
          if (t) { setDetectedHome(t); setMode(t === 'adapter' ? 'bridge-oft' : 'oft-oft'); }
        } else if (starkHome) {
          const r = await cairo.detectCairoOFTType(homeAddr, starkHome.rpc).catch(() => null);
          if (r) {
            setDetectedHome(r.type);
            setMode(r.type === 'adapter' ? 'bridge-oft' : 'oft-oft');
            if (r.tokenAddr) setEvmUnderlyingToken(r.tokenAddr);
          }
        }
      } catch { setDetectedHome(null); }
      finally { setDetecting(false); }
    }, 800);
    return () => clearTimeout(detectTimer.current);
  }, [homeAddr, evmHome?.rpc, home.eid]); // eslint-disable-line react-hooks/exhaustive-deps

  const homeLabel = detectedHome === 'adapter' ? 'Adapter' : detectedHome === 'oft' ? 'OFT' : (mode === 'bridge-oft' ? 'Adapter' : 'OFT');
  const remoteLabel = 'OFT';

  function handleNetworkToggle(testnet: boolean) {
    setIsTestnet(testnet);
    setHomeChain(null);
    setRemoteChain(null);
  }

  return (
    <div className="space-y-6">

      {/* Pathway + Network bar */}
      <section className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-6">
        <div className="flex gap-2 items-center mb-4 flex-wrap">
          <button className={`tab-btn ${isTestnet ? 'tab-btn-active' : ''}`}
            onClick={() => handleNetworkToggle(true)}>Testnet</button>
          <button className={`tab-btn ${!isTestnet ? 'tab-btn-active' : ''}`}
            onClick={() => handleNetworkToggle(false)}>Mainnet</button>
          {chainsLoading && <span className="text-xs text-on-surface-variant">Loading chains…</span>}
          <div className="ml-auto flex gap-2 items-center">
            {detecting && <span className="text-[11px] text-on-surface-variant animate-pulse">Detecting type…</span>}
            {!detecting && detectedHome && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${detectedHome === 'adapter' ? 'bg-tertiary/10 text-tertiary border-tertiary/20' : 'bg-secondary/10 text-secondary border-secondary/20'}`}>
                {detectedHome === 'adapter' ? 'Adapter' : 'OFT'}
              </span>
            )}
            {!detecting && !detectedHome && (
              <>
                <span className="text-xs text-on-surface-variant">Type:</span>
                <button
                  className={`px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${mode === 'bridge-oft' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
                  onClick={() => setMode('bridge-oft')}>Adapter</button>
                <button
                  className={`px-3 py-1 rounded text-xs font-headline font-bold border transition-colors ${mode === 'oft-oft' ? 'bg-primary/15 text-primary border-primary/30' : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
                  onClick={() => setMode('oft-oft')}>OFT</button>
              </>
            )}
          </div>
        </div>

        {/* Chain selectors + addresses — compact 2-row grid */}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">{homeLabel} (source) — EID {home.eid}</div>
            <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={home}
              disabledEid={remote.eid}
              onSelect={(c) => { setHomeChain(c); }} />
          </div>
          <button className="btn btn-sm mb-0.5 flex-shrink-0" title="Swap"
            onClick={() => {
              setHomeChain(remoteChain ?? remote);
              setRemoteChain(homeChain ?? home);
              const tmp = homeAddr;
              setHomeAddr(remoteAddr);
              setRemoteAddr(tmp);
            }}>⇄</button>
          <div className="flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">{remoteLabel} (destination) — EID {remote.eid}</div>
            <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={remote}
              disabledEid={home.eid}
              onSelect={(c) => { setRemoteChain(c); }} />
          </div>
        </div>
        <div className="flex gap-3 items-end mt-2">
          <div className="flex-1">
            <input className="input" value={homeAddr} onChange={(e) => setHomeAddr(e.target.value)} spellCheck={false} placeholder={`${homeLabel} address`} />
          </div>
          <div className="w-[34px] flex-shrink-0" />
          <div className="flex-1">
            <input className="input" value={remoteAddr} onChange={(e) => setRemoteAddr(e.target.value)} spellCheck={false} placeholder={`${remoteLabel} address`} />
          </div>
        </div>
      </section>

      {/* Send Panel */}
      <SendPanel
        home={home} remote={remote}
        homeAddr={homeAddr} remoteAddr={remoteAddr}
        mode={mode} evm={evm} stark={stark}
        wiring={wiring} cairo={cairo}
        isTestnet={isTestnet}
        evmUnderlyingToken={evmUnderlyingToken}
      />
    </div>
  );
}

// ── Send Panel ───────────────────────────────────────────────────────────────

function SendPanel({ home, remote, homeAddr, remoteAddr, mode, evm, stark, wiring, cairo, isTestnet, evmUnderlyingToken }: {
  home: AnyChain; remote: AnyChain;
  homeAddr: string; remoteAddr: string;
  mode: WiringMode;
  evm: ReturnType<typeof useEvmWallet>;
  stark: ReturnType<typeof useStarknetWallet>;
  wiring: ReturnType<typeof useOFTWiring>;
  cairo: ReturnType<typeof useCairoOFT>;
  isTestnet: boolean;
  evmUnderlyingToken?: string | null;
}): JSX.Element {
  const isAdapter = mode === 'bridge-oft';
  const [direction, setDirection] = useState<'AtoB' | 'BtoA'>('AtoB');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [slippage, setSlippage] = useState('5');
  const [starkTokenAddr, setStarkTokenAddr] = useState(evmUnderlyingToken ?? '');
  const [starkFeeToken, setStarkFeeToken] = useState('0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d');

  useEffect(() => {
    if (evmUnderlyingToken && !starkTokenAddr) setStarkTokenAddr(evmUnderlyingToken);
  }, [evmUnderlyingToken]); // eslint-disable-line

  const [quoting, setQuoting] = useState(false);
  const [quotedFee, setQuotedFee] = useState<{ nativeFee: bigint; lzTokenFee: bigint } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [approveTx, setApproveTx] = useState<TxState>({ status: 'idle' });
  const [sendTx, setSendTx] = useState<TxState>({ status: 'idle' });

  const srcChain = direction === 'AtoB' ? home : remote;
  const dstChain = direction === 'AtoB' ? remote : home;
  const srcAddr = direction === 'AtoB' ? homeAddr : remoteAddr;
  const dstAddr = direction === 'AtoB' ? remoteAddr : homeAddr;
  const srcIsStark = isStarknet(srcChain);

  const needsApproval = isAdapter && direction === 'AtoB' && !srcIsStark;

  function parseAmount(decimals: number): bigint {
    try {
      const parts = amount.split('.');
      const whole = parts[0] || '0';
      const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
      return BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
    } catch { return 0n; }
  }

  function toBytes32(addr: string): string {
    try { return '0x' + BigInt(addr).toString(16).padStart(64, '0'); }
    catch { return '0x' + '0'.repeat(64); }
  }

  async function handleQuote(): Promise<void> {
    setQuoteError(null); setQuotedFee(null); setQuoting(true);
    try {
      const amountLD = parseAmount(18);
      const slip = Number(slippage) || 5;
      const minAmountLD = amountLD * BigInt(100 - slip) / 100n;
      const recipientAddr = recipient || (evm.address ?? stark.address ?? '');
      if (srcIsStark) {
        const starkData = starkChain(isTestnet);
        const fee = await cairo.cairoQuoteSend(srcAddr, dstChain.eid, recipientAddr, amountLD, minAmountLD, starkData.rpc);
        setQuotedFee(fee);
      } else {
        const fee = await wiring.quoteSend(srcAddr, dstChain.eid, toBytes32(recipientAddr), amountLD, minAmountLD);
        setQuotedFee(fee);
      }
    } catch (e) {
      setQuoteError(decodeContractError(e));
    } finally { setQuoting(false); }
  }

  async function handleApprove(): Promise<void> {
    if (!srcIsStark && isAdapter && direction === 'AtoB') {
      setApproveTx({ status: 'pending' });
      try {
        const provider = evm.signer!;
        const c = new (await import('ethers')).Contract(srcAddr, (await import('@/abis/evm/OFTAdapter.json')).default, provider);
        const tokenAddr = await c.token() as string;
        const amountLD = parseAmount(18);
        setApproveTx(await wiring.approveToken(tokenAddr, srcAddr, amountLD));
      } catch (e) {
        setApproveTx({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  async function handleSend(): Promise<void> {
    if (!quotedFee) return;
    const amountLD = parseAmount(18);
    const slip = Number(slippage) || 5;
    const minAmountLD = amountLD * BigInt(100 - slip) / 100n;
    const recipientAddr = recipient || (evm.address ?? stark.address ?? '');
    setSendTx({ status: 'pending' });
    try {
      if (srcIsStark) {
        const tokenAddr = isAdapter && starkTokenAddr ? starkTokenAddr : undefined;
        const feeToken = starkFeeToken || undefined;
        setSendTx(await cairo.cairoSend(srcAddr, dstChain.eid, recipientAddr, amountLD, minAmountLD, quotedFee, tokenAddr, feeToken));
      } else {
        setSendTx(await wiring.evmSend(srcAddr, dstChain.eid, toBytes32(recipientAddr), amountLD, minAmountLD, quotedFee));
      }
    } catch (e) {
      setSendTx({ status: 'error', message: decodeContractError(e) });
    }
  }

  const srcConnected = srcIsStark ? stark.address !== null : (evm.isConnected && evm.chainId === (srcChain as LZChain).chainId);

  return (
    <Section icon="send" title="Send Tokens" subtitle={`${srcChain.name} → ${dstChain.name}`}>
      {/* Direction toggle */}
      <div className="flex gap-2 mb-4">
        <button className={`tab-btn ${direction === 'AtoB' ? 'tab-btn-active' : ''}`}
          onClick={() => { setDirection('AtoB'); setQuotedFee(null); }}>
          {home.name} → {remote.name}
        </button>
        <button className={`tab-btn ${direction === 'BtoA' ? 'tab-btn-active' : ''}`}
          onClick={() => { setDirection('BtoA'); setQuotedFee(null); }}>
          {remote.name} → {home.name}
        </button>
      </div>

      <div className="text-xs text-on-surface-variant mb-3">
        Source: <span className="text-on-surface font-mono">{srcAddr.slice(0, 10)}…</span> on {srcChain.name}
        {' → '}Destination: <span className="text-on-surface font-mono">{dstAddr.slice(0, 10)}…</span> on {dstChain.name}
      </div>

      {/* Amount + recipient */}
      <div className="form-grid mb-3">
        <div>
          <div className="label">Amount</div>
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
        </div>
        <div>
          <div className="label">Recipient (leave empty = self)</div>
          <input className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={evm.address ?? stark.address ?? '0x…'} spellCheck={false} />
        </div>
      </div>

      <div className="form-grid mb-3">
        <div>
          <div className="label">Slippage tolerance (%)</div>
          <input className="input w-[80px]" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </div>
        {srcIsStark && (
          <div>
            <div className="label">Fee token address (STRK default)</div>
            <input className="input" value={starkFeeToken} onChange={(e) => setStarkFeeToken(e.target.value)}
              placeholder="0x… STRK on Starknet" spellCheck={false} />
            <div className="text-[11px] text-[var(--text-muted)] mt-1">Fee approval is bundled with the send tx.</div>
          </div>
        )}
        {srcIsStark && isAdapter && (
          <div>
            <div className="label">Underlying token address (adapter lockbox)</div>
            <input className="input" value={starkTokenAddr} onChange={(e) => setStarkTokenAddr(e.target.value)}
              placeholder="0x… (required for adapter approval)" spellCheck={false} />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 items-center flex-wrap">
        <button className="btn" onClick={handleQuote} disabled={quoting || !amount || !srcAddr}>
          {quoting ? 'Quoting…' : 'Quote Fee'}
        </button>
        {needsApproval && (
          <button className="btn" onClick={handleApprove} disabled={approveTx.status === 'pending' || !amount}>
            {approveTx.status === 'pending' ? 'Approving…' : 'Approve'}
          </button>
        )}
        <button className="btn btn-primary" onClick={handleSend}
          disabled={!quotedFee || sendTx.status === 'pending' || !srcConnected}>
          {sendTx.status === 'pending' ? 'Sending…' : 'Send'}
        </button>
        {!srcConnected && !srcIsStark && evm.isConnected && (
          <button className="btn btn-sm" onClick={() => evm.switchNetwork((srcChain as LZChain).chainId)}>
            Switch to {srcChain.name}
          </button>
        )}
      </div>

      {/* Status */}
      {quoteError && <div className="text-xs text-error mt-2">{quoteError}</div>}
      {quotedFee && (
        <div className="bg-surface-container rounded-lg p-3 mt-3 border border-outline-variant/10">
          <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Quoted fee</div>
          <div className="text-sm text-on-surface font-mono">
            {(Number(quotedFee.nativeFee) / 1e18).toFixed(6)} native
            {quotedFee.lzTokenFee > 0n && ` + ${(Number(quotedFee.lzTokenFee) / 1e18).toFixed(6)} LZ token`}
          </div>
        </div>
      )}

      <div className="mt-3">
        {approveTx.status !== 'idle' && <TxStatus state={approveTx} />}
        <TxStatus state={sendTx} showLzScan />
      </div>
    </Section>
  );
}

// ── Chain select (reused from OFTWiring pattern) ─────────────────────────────

function chainIconUrl(chainKey: string): string {
  const base = chainKey
    .replace(/-sepolia$/i, '').replace(/-testnet$/i, '').replace(/-goerli$/i, '')
    .replace(/-fuji$/i, '').replace(/-mumbai$/i, '').replace(/-nova$/i, '-nova').toLowerCase();
  const overrides: Record<string, string> = {
    'ethereum': 'ethereum', 'bsc': 'bsc', 'avalanche': 'avax', 'polygon': 'polygon',
    'zksync': 'era', 'gnosis': 'xdai',
  };
  return `https://icons.llamao.fi/icons/chains/rsz_${overrides[base] ?? base}.jpg`;
}

function ChainIcon({ chainKey, size = 18 }: { chainKey: string; size?: number }): JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [chainKey]);
  if (failed) return <span className="w-[18px] h-[18px] rounded-full bg-[#1e1e2e] flex-shrink-0 inline-flex items-center justify-center text-[8px] text-[#6c6c8a]">?</span>;
  return <img src={chainIconUrl(chainKey)} alt="" width={size} height={size} onError={() => setFailed(true)} className="rounded-full flex-shrink-0 object-cover" />;
}

function chainCategory(c: LZChain): 'L1' | 'L2' {
  const n = c.name.toLowerCase();
  const k = c.chainKey.toLowerCase();
  if (n.includes('arbitrum') || n.includes('optimism') || n.includes('base') ||
      n.includes('zksync') || n.includes('linea') || n.includes('scroll') ||
      n.includes('blast') || n.includes('mantle') || n.includes('mode') ||
      k.includes('op-') || k.includes('arb') || k.includes('zk') || k.includes('l2')) return 'L2';
  return 'L1';
}

function AnyChainSelect({ evmChains, isTestnet, selected, onSelect, disabledEid }: {
  evmChains: LZChain[]; isTestnet: boolean; selected: AnyChain; onSelect: (c: AnyChain) => void; disabledEid?: number;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stark = starkChain(isTestnet);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); else setQuery(''); }, [open]);

  const q = query.toLowerCase();
  const filteredEvm = evmChains.filter((c) => c.name.toLowerCase().includes(q) || String(c.eid).includes(q));
  const isSelectedStark = isStarknet(selected);
  const selectedChainKey = isSelectedStark ? '' : (selected as LZChain).chainKey;
  const displayName = `${selected.name} — EID ${selected.eid}`;
  const snMonogram = <span className="w-[18px] h-[18px] rounded-full bg-[#919bff22] border border-[#919bff55] flex-shrink-0 inline-flex items-center justify-center text-[9px] text-[#919bff] font-bold">SN</span>;

  return (
    <div ref={ref} className="relative">
      <button className={`input text-left cursor-pointer flex items-center gap-2 justify-between ${isSelectedStark ? 'border-[#2a2a5a] text-[#919bff]' : ''}`}
        onClick={() => setOpen((v) => !v)} type="button">
        <span className="flex items-center gap-2 truncate">
          {isSelectedStark ? snMonogram : <ChainIcon chainKey={selectedChainKey} size={18} />}
          {displayName}
        </span>
        <span className="text-[11px] text-on-surface-variant ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="chain-dropdown">
          <div className={`chain-option border-b border-outline-variant/10 ${isSelectedStark ? 'chain-option-active' : ''} ${disabledEid === stark.eid ? 'chain-option-disabled' : ''}`}
            onClick={() => { if (disabledEid !== stark.eid) { onSelect(stark); setOpen(false); } }}>
            {snMonogram}
            <span className={isSelectedStark ? 'text-[#919bff]' : 'text-[#919bff88]'}>{stark.name}</span>
            <span className="text-[11px] text-on-surface-variant ml-auto">EID {stark.eid}</span>
          </div>
          <div className="p-2 border-b border-outline-variant/10">
            <input ref={inputRef} className="input" placeholder="Search chain or EID…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="overflow-y-auto max-h-[260px]">
            {filteredEvm.length === 0 && <div className="px-3 py-2.5 text-on-surface-variant text-[13px]">No chains match</div>}
            {(['L1', 'L2'] as const).map((cat) => {
              const group = filteredEvm.filter((c) => chainCategory(c) === cat);
              if (group.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="label px-3 pt-2 pb-0.5 mb-0">{cat}</div>
                  {group.map((c) => {
                    const isDisabled = disabledEid === c.eid;
                    return (
                      <div key={c.eid}
                        className={`chain-option ${!isSelectedStark && (selected as LZChain).eid === c.eid ? 'chain-option-active' : ''} ${isDisabled ? 'chain-option-disabled' : ''}`}
                        onClick={() => { if (!isDisabled) { onSelect(toAnyEvm(c)); setOpen(false); } }}>
                        <ChainIcon chainKey={c.chainKey} size={18} />
                        <span>{c.name}</span>
                        <span className="text-[11px] text-on-surface-variant ml-auto">EID {c.eid}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
