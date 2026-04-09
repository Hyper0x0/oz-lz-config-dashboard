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

  const rl = verifyResult?.homeRateLimit;

  // Read token decimals + symbol from the adapter's underlying token
  useEffect(() => {
    if (!home.contractAddr || home.contractAddr === '0x' || home.kind === 'starknet') return;
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
        // Auto-fill a sensible default if empty
        if (!limit) setLimit(String(BigInt(1_000_000) * BigInt(10 ** Number(dec))));
      } catch { /* not an adapter or read failed */ }
    })();
  }, [home.contractAddr, home.evmChain?.rpc]); // eslint-disable-line react-hooks/exhaustive-deps

  function formatTokenAmount(raw: bigint): string {
    if (tokenDecimals == null) return raw.toString();
    const whole = raw / BigInt(10 ** tokenDecimals);
    const frac = (raw % BigInt(10 ** tokenDecimals)).toString().padStart(tokenDecimals, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole.toString();
  }

  async function handleSet(): Promise<void> {
    setTx({ status: 'pending' });
    const result = await hooks.wiring.setRateLimit(home.contractAddr, remote.chain.eid, BigInt(limit), Number(window_));
    setTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  return (
    <div>
      <p className="step-hint">
        Rate limits cap how much can be bridged per time window. Set limit to 0 to disable.
        Applies to the adapter on the source chain only.
      </p>

      {rl && (
        <div className="text-xs text-[var(--text-muted)] mb-3">
          Current: {formatTokenAmount(rl.limit)}{tokenSymbol ? ` ${tokenSymbol}` : ''} per {rl.window}s
          {tokenDecimals != null && <span className="opacity-60"> (raw: {rl.limit.toString()})</span>}
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
            <div className="text-[11px] text-[var(--text-muted)] mt-1">Depends on token supply & decimals</div>
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
