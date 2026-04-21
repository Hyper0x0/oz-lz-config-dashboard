import { useState, useEffect } from 'react';
import { TxStatus } from '@/components/TxStatus';
import type { TxState } from '@/types';
import type { StepProps } from '../types';
import { explorerTxUrl } from '../types';
import { NetworkHint } from './StepDelegate';

export function StepRateLimit({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const homeDefaults = home.evmChain?.defaults ?? home.starkChain?.defaults;
  const defaultWindow = String(homeDefaults?.rateLimitWindow ?? 3600);
  const [limit, setLimit] = useState('');
  const [window_, setWindow] = useState(defaultWindow);
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);
  const [starkRl, setStarkRl] = useState<{ limit: bigint; window: number } | null>(null);

  const isStark = home.kind === 'starknet';
  const evmRl = verifyResult?.homeRateLimit;

  // EVM: read decimals + symbol from underlying ERC20
  useEffect(() => {
    if (isStark) return;
    if (!home.contractAddr || home.contractAddr === '0x') return;
    (async () => {
      try {
        const { Contract, JsonRpcProvider } = await import('ethers');
        const rpc = home.evmChain?.rpc;
        if (!rpc) return;
        const p = new JsonRpcProvider(rpc);
        const adapter = new Contract(home.contractAddr, (await import('@/abis/evm/OFTAdapter.json')).default, p);
        const tokenAddr = await adapter.token() as string;
        const erc20 = new Contract(tokenAddr, ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'], p);
        const [dec, sym] = await Promise.all([erc20.decimals(), erc20.symbol()]);
        setTokenDecimals(Number(dec));
        setTokenSymbol(sym as string);
        if (!limit) setLimit(String(BigInt(1_000_000) * BigInt(10 ** Number(dec))));
      } catch { /* not an adapter or read failed */ }
    })();
  }, [home.contractAddr, home.evmChain?.rpc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Starknet: read current outbound rate limit + underlying token info (symbol + decimals)
  useEffect(() => {
    if (!isStark) return;
    if (!home.contractAddr || home.contractAddr === '0x' || !home.starkChain) return;
    const rpc = home.starkChain.rpc;
    const dstEid = remote.chain.eid;
    (async () => {
      try {
        const rl = await hooks.cairo.readOutboundRateLimit(home.contractAddr, dstEid, rpc);
        setStarkRl(rl);
      } catch { setStarkRl(null); }
      try {
        const detect = await hooks.cairo.detectCairoOFTType(home.contractAddr, rpc);
        if (detect.type === 'adapter' && detect.tokenAddr) {
          const [info, dec] = await Promise.all([
            hooks.cairo.readCairoTokenInfo(detect.tokenAddr, rpc),
            hooks.cairo.readCairoTokenDecimals(detect.tokenAddr, rpc),
          ]);
          if (info.symbol) setTokenSymbol(info.symbol);
          if (dec != null) {
            setTokenDecimals(dec);
            // Auto-fill 1M tokens default (same as EVM) once decimals are known
            if (!limit) setLimit(String(BigInt(1_000_000) * BigInt(10 ** dec)));
          }
        }
      } catch { /* token read is optional */ }
    })();
  }, [home.contractAddr, home.starkChain?.rpc, remote.chain.eid, isStark]); // eslint-disable-line react-hooks/exhaustive-deps

  function formatTokenAmount(raw: bigint): string {
    if (tokenDecimals == null) return raw.toString();
    const whole = raw / BigInt(10 ** tokenDecimals);
    const frac = (raw % BigInt(10 ** tokenDecimals)).toString().padStart(tokenDecimals, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole.toString();
  }

  async function handleSet(): Promise<void> {
    setTx({ status: 'pending' });
    const result = isStark
      ? await hooks.cairo.setCairoRateLimit(home.contractAddr, remote.chain.eid, BigInt(limit || '0'), Number(window_))
      : await hooks.wiring.setRateLimit(home.contractAddr, remote.chain.eid, BigInt(limit || '0'), Number(window_));
    setTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  const currentRl = isStark ? starkRl : evmRl;

  return (
    <div>
      <p className="step-hint">
        Rate limits cap how much can be bridged per time window. Set limit to 0 to disable.
        Applies to the adapter on the source chain only ({isStark ? 'Starknet outbound' : 'EVM adapter'}).
      </p>

      {currentRl && (
        <div className="text-xs text-[var(--text-muted)] mb-3">
          Current: {formatTokenAmount(currentRl.limit)}{tokenSymbol ? ` ${tokenSymbol}` : ''} per {currentRl.window}s
          {tokenDecimals != null && <span className="opacity-60"> (raw: {currentRl.limit.toString()})</span>}
        </div>
      )}

      <div className="form-grid mb-3">
        <div>
          <div className="label">Limit (raw token units){tokenSymbol ? ` — ${tokenSymbol}` : ''}</div>
          <input className="input" value={limit} onChange={(e) => setLimit(e.target.value)} />
          {tokenDecimals != null && limit && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1">
              ≈ {formatTokenAmount(BigInt(limit || '0'))}{tokenSymbol ? ` ${tokenSymbol}` : ''} ({tokenDecimals} decimals)
            </div>
          )}
          {tokenDecimals == null && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1">
              {isStark ? 'Enter raw token units (u128).' : 'Depends on token supply & decimals'}
            </div>
          )}
        </div>
        <div>
          <div className="label">Window (seconds)</div>
          <input className="input" value={window_} onChange={(e) => setWindow(e.target.value)} placeholder={defaultWindow} />
          <div className="text-[11px] text-[var(--text-muted)] mt-1">
            Recommended: {homeDefaults?.rateLimitWindow ?? 3600}s ({(homeDefaults?.rateLimitWindow ?? 3600) <= 60 ? '1 min' : '1 hour'})
          </div>
        </div>
      </div>

      <NetworkHint side={home} />
      <button className="btn btn-primary" disabled={!home.isConnected || home.needsNetworkSwitch}
        onClick={handleSet}>Set Rate Limit</button>
      <div className="mt-1.5"><TxStatus state={tx} explorerUrl={explorerTxUrl(home)} /></div>
    </div>
  );
}
