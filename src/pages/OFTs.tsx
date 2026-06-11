import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@/context/WalletContext';
import { useOFTWiring } from '@/hooks/useOFTWiring';
import { useLZChains } from '@/hooks/useLZChains';
import { useCairoOFT } from '@/hooks/useCairoOFT';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { TxStatus } from '@/components/TxStatus';
import { SwitchChainButton } from '@/components/ChainSwitch';
import { CONTRACTS, STARKNET_TESTNET, STARKNET_MAINNET } from '@/config/chains';
import type { AnyChain, LZChain, StarknetChain } from '@/config/lzCatalog';
import { isStarknet, isEvm } from '@/config/lzCatalog';
import type { TxState } from '@/types';
import { decodeContractError, extractErrorDetails } from '@/utils/decodeError';

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
  // Default the source chain to the connected wallet's chain, so navigating between pages keeps
  // the chain you're on instead of snapping back to the first chain in the list.
  const walletEvmChain = evm.isConnected ? evmChains.find((c) => c.chainId === evm.chainId) : undefined;
  const home: AnyChain = homeChain ?? toAnyEvm(walletEvmChain ?? defaultEvm0);
  const remote: AnyChain = remoteChain ?? toAnyEvm(evmChains.find((c) => c.eid !== home.eid) ?? defaultEvm1);

  const [mode, setMode] = useState<WiringMode>('bridge-oft');
  const [detectedHome, setDetectedHome] = useState<'adapter' | 'oft' | null>(null);
  const [detectedRemote, setDetectedRemote] = useState<'adapter' | 'oft' | null>(null);
  const [detecting, setDetecting] = useState(false);

  const [homeAddr, setHomeAddr] = useState(CONTRACTS.adapter);
  const [remoteAddr, setRemoteAddr] = useState(CONTRACTS.peer);
  const [evmUnderlyingToken, setEvmUnderlyingToken] = useState<string | null>(null);
  const [decimals, setDecimals] = useState(18);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);

  const hasStarknet = isStarknet(home) || isStarknet(remote);
  const evmHome: LZChain | null = isEvm(home) ? home : null;
  const starkHome = isStarknet(home) ? home : null;

  // Auto-detect Adapter vs OFT
  const detectTimer = useRef<ReturnType<typeof setTimeout>>();
  const evmRemote: LZChain | null = isEvm(remote) ? remote : null;

  useEffect(() => {
    setDetectedHome(null);
    setDetectedRemote(null);
    const homeValid = isAddr(homeAddr);
    const remoteValid = isAddr(remoteAddr);
    if (!homeValid && !remoteValid) return;
    clearTimeout(detectTimer.current);
    setDetecting(true);
    detectTimer.current = setTimeout(async () => {
      try {
        if (evmHome && homeValid) {
          const wp = evm.provider && evm.chainId === evmHome.chainId ? evm.provider : undefined;
          const t = await wiring.detectOFTType(homeAddr, evmHome.rpc, wp, evmHome.chainId).catch(() => null);
          if (t) { setDetectedHome(t); setMode(t === 'adapter' ? 'bridge-oft' : 'oft-oft'); }
        } else if (starkHome && homeValid) {
          const r = await cairo.detectCairoOFTType(homeAddr, starkHome.rpc).catch(() => null);
          if (r && r.type !== 'unknown') {
            setDetectedHome(r.type);
            setMode(r.type === 'adapter' ? 'bridge-oft' : 'oft-oft');
            if (r.tokenAddr) setEvmUnderlyingToken(r.tokenAddr);
          }
        }
        if (evmRemote && remoteValid) {
          const rwp = evm.provider && evm.chainId === evmRemote.chainId ? evm.provider : undefined;
          const t = await wiring.detectOFTType(remoteAddr, evmRemote.rpc, rwp, evmRemote.chainId).catch(() => null);
          if (t) setDetectedRemote(t);
        } else if (isStarknet(remote) && remoteValid) {
          const starkR = remote as StarknetChain;
          const r = await cairo.detectCairoOFTType(remoteAddr, starkR.rpc).catch(() => null);
          if (r && r.type !== 'unknown') setDetectedRemote(r.type);
        }
      } catch { setDetectedHome(null); setDetectedRemote(null); }
      finally { setDetecting(false); }
    }, 800);
    return () => clearTimeout(detectTimer.current);
  }, [homeAddr, remoteAddr, evmHome?.rpc, evmRemote?.rpc, home.eid, remote.eid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read decimals + balance + symbol after type detection
  useEffect(() => {
    setDecimals(18);
    setWalletBalance(null);
    setTokenSymbol(null);
    if (!isAddr(homeAddr) || detecting) return;
    (async () => {
      try {
        if (evmHome) {
          const { Contract: C, JsonRpcProvider: P } = await import('ethers');
          const p = evm.provider && evm.chainId === evmHome.chainId ? evm.provider : new P(evmHome.rpc);
          let tokenAddr = homeAddr;
          if (detectedHome === 'adapter') {
            const c = new C(homeAddr, (await import('@/abis/evm/OFTAdapter.json')).default, p);
            tokenAddr = await c.token() as string;
            setEvmUnderlyingToken(tokenAddr);
          }
          const erc20 = new C(tokenAddr, ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)'], p);
          const [dec, sym] = await Promise.all([erc20.decimals(), erc20.symbol().catch(() => null)]);
          const decNum = Number(dec);
          setDecimals(decNum);
          setTokenSymbol(sym as string | null);
          if (evm.address) {
            const bal = await erc20.balanceOf(evm.address) as bigint;
            const whole = bal / BigInt(10 ** decNum);
            const frac = (bal % BigInt(10 ** decNum)).toString().padStart(decNum, '0').slice(0, 4);
            setWalletBalance(`${whole}.${frac}`);
          }
        } else if (starkHome) {
          let dec = 18;
          let tokenAddr = homeAddr;
          try {
            const detect = await cairo.detectCairoOFTType(homeAddr, starkHome.rpc);
            if (detect.type === 'adapter' && detect.tokenAddr) tokenAddr = detect.tokenAddr;
          } catch { /* */ }
          try {
            const { RpcProvider: RP } = await import('starknet');
            const p = new RP({ nodeUrl: starkHome.rpc });
            const result = await p.callContract({ contractAddress: tokenAddr, entrypoint: 'decimals', calldata: [] }, 'latest');
            if (result[0]) dec = Number(BigInt(result[0]));
          } catch { /* default 18 */ }
          setDecimals(dec);
          if (stark.address) {
            const bal = await cairo.cairoBalance(tokenAddr, stark.address, starkHome.rpc);
            const whole = bal / BigInt(10 ** dec);
            const frac = (bal % BigInt(10 ** dec)).toString().padStart(dec, '0').slice(0, 4);
            setWalletBalance(`${whole}.${frac}`);
          }
          try {
            const info = await cairo.readCairoTokenInfo(tokenAddr, starkHome.rpc);
            if (info.symbol) setTokenSymbol(info.symbol);
          } catch { /* */ }
        }
      } catch { /* best-effort */ }
    })();
  }, [homeAddr, detectedHome, detecting, evm.address, stark.address, evmHome?.rpc]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleNetworkToggle(testnet: boolean) {
    setIsTestnet(testnet);
    setHomeChain(null);
    setRemoteChain(null);
  }

  function handleSwap() {
    setHomeChain(remoteChain ?? remote);
    setRemoteChain(homeChain ?? home);
    const tmp = homeAddr;
    setHomeAddr(remoteAddr);
    setRemoteAddr(tmp);
  }

  const homeLabel = detectedHome === 'adapter' ? 'Adapter' : detectedHome === 'oft' ? 'OFT' : (mode === 'bridge-oft' ? 'Adapter' : 'OFT');
  const remoteLabel = detectedRemote === 'adapter' ? 'Adapter' : detectedRemote === 'oft' ? 'OFT' : 'OFT';

  return (
    <div className="min-h-[calc(100vh-9rem)] flex items-center justify-center">
      <div className="w-full max-w-xl mx-auto space-y-5 reveal">

      {/* Network + Type bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 items-center">
          <div className="segmented">
            <button className={`tab-btn ${isTestnet ? 'tab-btn-active' : ''}`}
              onClick={() => handleNetworkToggle(true)}>Testnet</button>
            <button className={`tab-btn ${!isTestnet ? 'tab-btn-active' : ''}`}
              onClick={() => handleNetworkToggle(false)}>Mainnet</button>
          </div>
          {chainsLoading && <span className="text-xs text-on-surface-variant animate-pulse">Loading...</span>}
        </div>

        <div className="flex gap-1.5 items-center">
          {detecting && <span className="text-[11px] text-on-surface-variant animate-pulse">Detecting...</span>}
          {!detecting && (detectedHome || detectedRemote) && (
            <>
              {detectedHome && (
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${detectedHome === 'adapter' ? 'bg-tertiary/10 text-tertiary border-tertiary/20' : 'bg-secondary/10 text-secondary border-secondary/20'}`}>
                  {detectedHome === 'adapter' ? 'Adapter' : 'OFT'}
                </span>
              )}
              {detectedRemote && (
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${detectedRemote === 'adapter' ? 'bg-tertiary/10 text-tertiary border-tertiary/20' : 'bg-secondary/10 text-secondary border-secondary/20'}`}>
                  {detectedRemote === 'adapter' ? 'Adapter' : 'OFT'}
                </span>
              )}
            </>
          )}
          {!detecting && !detectedHome && !detectedRemote && (
            <div className="flex gap-1.5">
              <button className={`px-3 py-1 rounded-md text-xs font-semibold border transition-colors ${mode === 'bridge-oft' ? 'bg-primary/10 text-primary border-primary/25' : 'bg-transparent text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
                onClick={() => setMode('bridge-oft')}>Adapter</button>
              <button className={`px-3 py-1 rounded-md text-xs font-semibold border transition-colors ${mode === 'oft-oft' ? 'bg-primary/10 text-primary border-primary/25' : 'bg-transparent text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}
                onClick={() => setMode('oft-oft')}>OFT</button>
            </div>
          )}
        </div>
      </div>

      {/* ── Single Swap Card ── */}
      <div className="swap-card">

        {/* Source panel */}
        <div className="swap-panel rounded-t-[var(--radius-2xl)]">
          <div className="swap-panel-label">From ({homeLabel})</div>
          <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={home}
            disabledEid={remote.eid}
            onSelect={(c) => setHomeChain(c)} />
          <input className="input text-sm mt-3" value={homeAddr} onChange={(e) => setHomeAddr(e.target.value)} spellCheck={false}
            placeholder="Contract address" />
          {walletBalance && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-[12px] text-on-surface-variant">Balance</span>
              <span className="text-[12px] text-on-surface font-mono">
                {walletBalance}{tokenSymbol ? ` ${tokenSymbol}` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Swap divider */}
        <div className="swap-divider">
          <button className="swap-divider-btn" onClick={handleSwap} title="Swap direction">
            <span className="material-symbols-outlined text-lg">swap_vert</span>
          </button>
        </div>

        {/* Destination panel */}
        <div className="swap-panel border-t border-[var(--border)]">
          <div className="swap-panel-label">To ({remoteLabel})</div>
          <AnyChainSelect evmChains={evmChains} isTestnet={isTestnet} selected={remote}
            disabledEid={home.eid}
            onSelect={(c) => setRemoteChain(c)} />
          <input className="input text-sm mt-3" value={remoteAddr} onChange={(e) => setRemoteAddr(e.target.value)} spellCheck={false}
            placeholder="Contract address" />
        </div>

        {/* Wallet status bar */}
        <div className="px-5 py-2.5 border-t border-[var(--border)] flex items-center gap-3 flex-wrap text-xs">
          {(() => {
            const evmSide = evmHome ?? evmRemote;
            if (!evmSide || !evm.isConnected) return null;
            return evm.chainId === evmSide.chainId
              ? <span className="flex items-center gap-1.5 text-secondary"><span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>{evmSide.name}</span>
              : <SwitchChainButton chainName={evmSide.name} onSwitch={() => evm.switchNetwork(evmSide.chainId)} />;
          })()}
          {hasStarknet && stark.isConnected && (
            <span className="flex items-center gap-1.5 text-tertiary"><span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>Starknet</span>
          )}
        </div>

        {/* ── Send section (inside same card) ── */}
        <SendPanel
          home={home} remote={remote}
          homeAddr={homeAddr} remoteAddr={remoteAddr}
          evm={evm} stark={stark}
          wiring={wiring} cairo={cairo}
          isTestnet={isTestnet}
          detectedHome={detectedHome}
          detectedRemote={detectedRemote}
          decimals={decimals}
          walletBalance={walletBalance}
          tokenSymbol={tokenSymbol}
        />
      </div>
      </div>
    </div>
  );
}

// ── Send Panel ───────────────────────────────────────────────────────────────

function SendPanel({ home, remote, homeAddr, remoteAddr, evm, stark, wiring, cairo, isTestnet, detectedHome, detectedRemote, decimals, walletBalance, tokenSymbol }: {
  home: AnyChain; remote: AnyChain;
  homeAddr: string; remoteAddr: string;
  evm: ReturnType<typeof useEvmWallet>;
  stark: ReturnType<typeof useStarknetWallet>;
  wiring: ReturnType<typeof useOFTWiring>;
  cairo: ReturnType<typeof useCairoOFT>;
  isTestnet: boolean;
  detectedHome: 'adapter' | 'oft' | null;
  detectedRemote: 'adapter' | 'oft' | null;
  decimals: number;
  walletBalance: string | null;
  tokenSymbol: string | null;
}): JSX.Element {
  const [direction, setDirection] = useState<'AtoB' | 'BtoA'>('AtoB');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [slippage, setSlippage] = useState('5');
  const [starkTokenAddr, setStarkTokenAddr] = useState('');
  const [starkFeeToken, setStarkFeeToken] = useState('0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d');
  const [balanceRefresh, setBalanceRefresh] = useState(0);

  const [quoting, setQuoting] = useState(false);
  const [quotedFee, setQuotedFee] = useState<{ nativeFee: bigint; lzTokenFee: bigint } | null>(null);
  const [quoteTx, setQuoteTx] = useState<TxState>({ status: 'idle' });
  const [approveTx, setApproveTx] = useState<TxState>({ status: 'idle' });
  const [sendTx, setSendTx] = useState<TxState>({ status: 'idle' });

  const srcChain = direction === 'AtoB' ? home : remote;
  const dstChain = direction === 'AtoB' ? remote : home;
  const srcAddr = direction === 'AtoB' ? homeAddr : remoteAddr;
  const dstAddr = direction === 'AtoB' ? remoteAddr : homeAddr;
  const srcIsStark = isStarknet(srcChain);
  const dstIsStark = isStarknet(dstChain);
  const defaultRecipient = dstIsStark ? (stark.address ?? '') : (evm.address ?? '');
  const srcDetected = direction === 'AtoB' ? detectedHome : detectedRemote;
  const srcIsAdapter = srcDetected === 'adapter';

  useEffect(() => {
    if (!srcIsStark || !srcIsAdapter) return;
    if (starkTokenAddr) return;
    (async () => {
      try {
        const rpc = (srcChain as StarknetChain).rpc;
        const r = await cairo.detectCairoOFTType(srcAddr, rpc);
        if (r.type === 'adapter' && r.tokenAddr) setStarkTokenAddr(r.tokenAddr);
      } catch { /* best-effort */ }
    })();
  }, [srcIsStark, srcIsAdapter, srcAddr]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsApproval = srcIsStark ? true : srcIsAdapter;

  // Auto-quote when amount changes (debounced)
  const quoteTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    setQuotedFee(null);
    if (!amount || !srcAddr || Number(amount) <= 0) return;
    clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(() => {
      handleQuote();
    }, 1200);
    return () => clearTimeout(quoteTimer.current);
  }, [amount, srcAddr, srcChain.eid, dstChain.eid]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setQuoteTx({ status: 'idle' }); setQuotedFee(null); setQuoting(true);
    try {
      const amountLD = parseAmount(decimals);
      const slip = Number(slippage) || 5;
      const minAmountLD = amountLD * BigInt(100 - slip) / 100n;
      const recipientAddr = recipient || defaultRecipient;
      if (!recipientAddr) { setQuoteTx({ status: 'error', message: `Connect your ${dstIsStark ? 'Starknet' : 'EVM'} wallet or enter a recipient address.` }); return; }
      if (srcIsStark) {
        const starkData = starkChain(isTestnet);
        const fee = await cairo.cairoQuoteSend(srcAddr, dstChain.eid, recipientAddr, amountLD, minAmountLD, starkData.rpc);
        setQuotedFee(fee);
      } else {
        const fee = await wiring.quoteSend(srcAddr, dstChain.eid, toBytes32(recipientAddr), amountLD, minAmountLD);
        setQuotedFee(fee);
      }
    } catch (e) {
      const fn = srcIsStark ? 'cairoQuoteSend' : 'quoteSend';
      const call = `${fn}(${srcAddr}, dstEid: ${dstChain.eid}, amount: ${parseAmount(decimals)})`;
      setQuoteTx({ status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: srcAddr, functionName: fn, functionCall: call }) });
    } finally { setQuoting(false); }
  }

  async function handleApprove(): Promise<void> {
    setApproveTx({ status: 'pending' });
    const amountLD = parseAmount(decimals);
    try {
      if (srcIsStark) {
        if (!quotedFee) { setApproveTx({ status: 'error', message: 'Quote the fee first.' }); return; }
        const feeToken = starkFeeToken;
        if (!feeToken) { setApproveTx({ status: 'error', message: 'Fee token address missing' }); return; }
        const underlying = srcIsAdapter && starkTokenAddr ? starkTokenAddr : undefined;
        setApproveTx(await cairo.cairoApprove(srcAddr, feeToken, quotedFee.nativeFee, underlying, amountLD));
      } else if (srcIsAdapter) {
        const provider = evm.signer!;
        const c = new (await import('ethers')).Contract(srcAddr, (await import('@/abis/evm/OFTAdapter.json')).default, provider);
        const tokenAddr = await c.token() as string;
        setApproveTx(await wiring.approveToken(tokenAddr, srcAddr, amountLD));
      }
    } catch (e) {
      setApproveTx({ status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: srcAddr, functionName: 'approve', functionCall: `approve(${srcAddr}, ${amountLD})` }) });
    }
  }

  async function handleSend(): Promise<void> {
    if (!quotedFee) return;
    const amountLD = parseAmount(decimals);
    const slip = Number(slippage) || 5;
    const minAmountLD = amountLD * BigInt(100 - slip) / 100n;
    const recipientAddr = recipient || defaultRecipient;
    if (!recipientAddr) { setSendTx({ status: 'error', message: `Connect your ${dstIsStark ? 'Starknet' : 'EVM'} wallet or enter a recipient address.` }); return; }
    setSendTx({ status: 'pending' });
    try {
      if (srcIsStark) {
        setSendTx(await cairo.cairoSend(srcAddr, dstChain.eid, recipientAddr, amountLD, minAmountLD, quotedFee));
      } else {
        setSendTx(await wiring.evmSend(srcAddr, dstChain.eid, toBytes32(recipientAddr), amountLD, minAmountLD, quotedFee));
      }
    } catch (e) {
      const fn = srcIsStark ? 'send (Cairo OFT)' : 'send (EVM OFT)';
      const call = srcIsStark
        ? `cairoSend(${srcAddr}, dstEid: ${dstChain.eid}, to: ${recipientAddr}, amount: ${amountLD}, min: ${minAmountLD})`
        : `evmSend(${srcAddr}, dstEid: ${dstChain.eid}, to: ${toBytes32(recipientAddr)}, amount: ${amountLD}, min: ${minAmountLD})`;
      setSendTx({ status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: srcAddr, functionName: fn, functionCall: call }) });
    }
  }

  const srcConnected = srcIsStark ? stark.address !== null : (evm.isConnected && evm.chainId === (srcChain as LZChain).chainId);

  return (
    <div className="border-t border-[var(--border)]">
      {/* Send header */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-on-surface">Send</span>
          <span className="text-[12px] text-on-surface-variant">{srcChain.name} &rarr; {dstChain.name}</span>
        </div>
      </div>

      {/* Amount + options */}
      <div className="px-5 pb-5 space-y-3">
        {/* Amount */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="label mb-0">Amount{tokenSymbol ? ` (${tokenSymbol})` : ''}</span>
            {walletBalance && (
              <button className="text-[11px] text-primary hover:underline cursor-pointer bg-transparent border-none p-0 font-mono"
                onClick={() => setAmount(walletBalance)}>
                Max: {walletBalance}
              </button>
            )}
          </div>
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
        </div>

        {/* Recipient */}
        <div>
          <span className="label">Recipient on {dstChain.name} <span className="text-on-surface-variant/50 font-normal">(leave empty = self)</span></span>
          <input className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)}
            placeholder={defaultRecipient || (dstIsStark ? '0x... (Starknet)' : '0x... (EVM)')} spellCheck={false} />
        </div>

        {/* Slippage */}
        <div className="flex gap-3">
          <div className="w-24">
            <span className="label">Slippage %</span>
            <input className="input" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
          </div>
          {decimals !== 18 && <div className="flex items-end pb-1"><span className="text-[11px] text-on-surface-variant">{decimals} decimals</span></div>}
        </div>

        {/* Starknet extras */}
        {srcIsStark && (
          <div>
            <span className="label">Fee token (STRK)</span>
            <input className="input text-xs font-mono" value={starkFeeToken} onChange={(e) => setStarkFeeToken(e.target.value)}
              placeholder="0x... STRK on Starknet" spellCheck={false} />
          </div>
        )}
        {srcIsStark && srcIsAdapter && (
          <div>
            <span className="label">Underlying token (adapter lockbox)</span>
            <input className="input text-xs font-mono" value={starkTokenAddr} onChange={(e) => setStarkTokenAddr(e.target.value)}
              placeholder="0x... (required for adapter approval)" spellCheck={false} />
          </div>
        )}

        {/* Quoted fee */}
        {quotedFee && (
          <div className="bg-[var(--bg)] rounded-xl p-3 border border-[var(--border)]">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-on-surface-variant">Estimated fee</span>
              <span className="text-[13px] text-on-surface font-mono">
                {(Number(quotedFee.nativeFee) / 1e18).toFixed(6)} native
                {quotedFee.lzTokenFee > 0n && ` + ${(Number(quotedFee.lzTokenFee) / 1e18).toFixed(6)} LZ`}
              </span>
            </div>
          </div>
        )}

        {/* Quoting indicator */}
        {quoting && (
          <div className="text-xs text-on-surface-variant animate-pulse text-center py-1">Quoting fee...</div>
        )}

        {/* Actions */}
        <div className="flex gap-2 items-center flex-wrap pt-1">
          {needsApproval && (
            <button className="btn flex-1" onClick={handleApprove}
              disabled={approveTx.status === 'pending' || !amount || (srcIsStark && !quotedFee)}
              title={srcIsStark && !quotedFee ? 'Quote the fee first' : undefined}>
              {approveTx.status === 'pending' ? 'Approving...' : srcIsStark ? (srcIsAdapter ? 'Approve All' : 'Approve Fee') : 'Approve'}
            </button>
          )}
          <button className="btn btn-primary flex-1" onClick={handleSend}
            disabled={!quotedFee || sendTx.status === 'pending' || !srcConnected}>
            {sendTx.status === 'pending' ? 'Sending...' : quoting ? 'Quoting...' : 'Send'}
          </button>
        </div>

        {!srcConnected && !srcIsStark && evm.isConnected && (
          <div className="pt-1">
            <SwitchChainButton chainName={srcChain.name} onSwitch={() => evm.switchNetwork((srcChain as LZChain).chainId)} />
          </div>
        )}

        {/* Status */}
        {quoteTx.status === 'error' && (
          <div>
            <TxStatus state={quoteTx} />
            <button className="btn btn-sm mt-2" onClick={handleQuote} disabled={quoting || !amount}>
              <span className="material-symbols-outlined text-sm">refresh</span> Retry Quote
            </button>
          </div>
        )}
        {approveTx.status !== 'idle' && <TxStatus state={approveTx} />}
        <TxStatus state={sendTx} showLzScan />
      </div>
    </div>
  );
}

// ── Side balance ────────────────────────────────────────────────────────────

function SideBalance({ label, chain, oftAddr, detectedType, evm, stark, cairo, starkFeeToken, refreshKey }: {
  label: string;
  chain: AnyChain;
  oftAddr: string;
  detectedType: 'adapter' | 'oft' | null;
  evm: ReturnType<typeof useEvmWallet>;
  stark: ReturnType<typeof useStarknetWallet>;
  cairo: ReturnType<typeof useCairoOFT>;
  starkFeeToken: string;
  refreshKey: number;
}): JSX.Element {
  const [state, setState] = useState<{ token: string; tokenSym: string; native: string; nativeSym: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    if (!isAddr(oftAddr)) { setState(null); return; }

    (async () => {
      try {
        if (isEvm(chain)) {
          if (!evm.address) { setState(null); return; }
          const { Contract: C, JsonRpcProvider: P, Network, formatEther, formatUnits } = await import('ethers');
          const net = Network.from(chain.chainId);
          const provider = new P(chain.rpc, net, { staticNetwork: net });
          let tokenAddr = oftAddr;
          if (detectedType === 'adapter') {
            const adapter = new C(oftAddr, (await import('@/abis/evm/OFTAdapter.json')).default, provider);
            tokenAddr = await adapter.token() as string;
          }
          const erc20 = new C(tokenAddr, ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)'], provider);
          const [dec, sym, bal, native] = await Promise.all([
            erc20.decimals(),
            erc20.symbol().catch(() => ''),
            erc20.balanceOf(evm.address) as Promise<bigint>,
            provider.getBalance(evm.address),
          ]);
          if (cancelled) return;
          setState({
            token: Number(formatUnits(bal, Number(dec))).toFixed(4),
            tokenSym: (sym as string) || '',
            native: Number(formatEther(native)).toFixed(4),
            nativeSym: 'ETH',
          });
        } else {
          if (!stark.address) { setState(null); return; }
          const starkC = chain as StarknetChain;
          let tokenAddr = oftAddr;
          try {
            const r = await cairo.detectCairoOFTType(oftAddr, starkC.rpc);
            if (r.type === 'adapter' && r.tokenAddr) tokenAddr = r.tokenAddr;
          } catch { /* */ }
          const { RpcProvider: RP } = await import('starknet');
          const p = new RP({ nodeUrl: starkC.rpc });
          const decResult = await p.callContract({ contractAddress: tokenAddr, entrypoint: 'decimals', calldata: [] }, 'latest').catch(() => null);
          const dec = decResult && decResult[0] ? Number(BigInt(decResult[0])) : 18;
          const [tokenBalRaw, symInfo, nativeBalRaw] = await Promise.all([
            cairo.cairoBalance(tokenAddr, stark.address, starkC.rpc),
            cairo.readCairoTokenInfo(tokenAddr, starkC.rpc).catch(() => ({ symbol: '' })),
            starkFeeToken ? cairo.cairoBalance(starkFeeToken, stark.address, starkC.rpc) : Promise.resolve(0n),
          ]);
          if (cancelled) return;
          const fmt = (v: bigint, d: number): string => {
            const whole = v / BigInt(10 ** d);
            const frac = (v % BigInt(10 ** d)).toString().padStart(d, '0').slice(0, 4);
            return `${whole}.${frac}`;
          };
          setState({
            token: fmt(tokenBalRaw, dec),
            tokenSym: symInfo.symbol || '',
            native: fmt(nativeBalRaw, 18),
            nativeSym: 'STRK',
          });
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [chain, oftAddr, detectedType, evm.address, stark.address, evm.chainId, starkFeeToken, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-[var(--bg)] rounded-xl px-3 py-2.5 border border-[var(--border)]">
      <div className="text-[11px] text-on-surface-variant mb-1 font-medium">{label}</div>
      {err ? (
        <div className="text-[11px] text-error font-mono truncate">{err.slice(0, 40)}</div>
      ) : !state ? (
        <div className="text-[11px] text-on-surface-variant font-mono">--</div>
      ) : (
        <div className="text-[12px] font-mono text-on-surface">
          <span>{state.token}</span>{state.tokenSym && <span className="text-on-surface-variant"> {state.tokenSym}</span>}
          <span className="text-on-surface-variant/40 mx-1.5">/</span>
          <span>{state.native}</span><span className="text-on-surface-variant"> {state.nativeSym}</span>
        </div>
      )}
    </div>
  );
}

// ── Chain select ────────────────────────────────────────────────────────────

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

function ChainIcon({ chainKey, size = 20 }: { chainKey: string; size?: number }): JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [chainKey]);
  if (failed) return <span style={{ width: size, height: size }} className="rounded-full bg-surface-container-high flex-shrink-0 inline-flex items-center justify-center text-[8px] text-on-surface-variant">?</span>;
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
  const displayName = selected.name;
  const snMonogram = <span className="w-5 h-5 rounded-md bg-tertiary/15 border border-tertiary/30 flex-shrink-0 inline-flex items-center justify-center text-[9px] text-tertiary font-bold">SN</span>;

  return (
    <div ref={ref} className="relative">
      <button className={`input text-left cursor-pointer flex items-center gap-2.5 justify-between ${isSelectedStark ? 'border-tertiary/20 text-tertiary' : ''}`}
        onClick={() => setOpen((v) => !v)} type="button">
        <span className="flex items-center gap-2.5 truncate">
          {isSelectedStark ? snMonogram : <ChainIcon chainKey={selectedChainKey} size={20} />}
          <span className="font-medium">{displayName}</span>
          <span className="text-[11px] text-on-surface-variant">EID {selected.eid}</span>
        </span>
        <span className="material-symbols-outlined text-on-surface-variant text-sm ml-2">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="chain-dropdown">
          <div className={`chain-option border-b border-[var(--border)] ${isSelectedStark ? 'chain-option-active' : ''} ${disabledEid === stark.eid ? 'chain-option-disabled' : ''}`}
            onClick={() => { if (disabledEid !== stark.eid) { onSelect(stark); setOpen(false); } }}>
            {snMonogram}
            <span className={isSelectedStark ? 'text-tertiary font-medium' : 'text-tertiary/70'}>{stark.name}</span>
            <span className="text-[11px] text-on-surface-variant ml-auto">EID {stark.eid}</span>
          </div>
          <div className="p-2.5 border-b border-[var(--border)]">
            <input ref={inputRef} className="input" placeholder="Search chain or EID..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="overflow-y-auto max-h-[260px]">
            {filteredEvm.length === 0 && <div className="px-4 py-3 text-on-surface-variant text-[13px]">No chains match</div>}
            {(['L1', 'L2'] as const).map((cat) => {
              const group = filteredEvm.filter((c) => chainCategory(c) === cat);
              if (group.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-on-surface-variant/50 font-semibold px-4 pt-2.5 pb-1">{cat}</div>
                  {group.map((c) => {
                    const isDisabled = disabledEid === c.eid;
                    return (
                      <div key={c.eid}
                        className={`chain-option ${!isSelectedStark && (selected as LZChain).eid === c.eid ? 'chain-option-active' : ''} ${isDisabled ? 'chain-option-disabled' : ''}`}
                        onClick={() => { if (!isDisabled) { onSelect(toAnyEvm(c)); setOpen(false); } }}>
                        <ChainIcon chainKey={c.chainKey} size={20} />
                        <span className="font-medium">{c.name}</span>
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
