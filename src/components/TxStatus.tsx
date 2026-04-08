import type { TxState } from '@/types';

interface Props {
  state: TxState;
  /** Base URL for block explorer (e.g. "https://sepolia.arbiscan.io/tx/"). Hash is appended. */
  explorerUrl?: string;
  /** Show LayerZero Scan link (only for cross-chain send transactions). */
  showLzScan?: boolean;
}

export function TxStatus({ state, explorerUrl, showLzScan }: Props): JSX.Element | null {
  if (state.status === 'idle') return null;

  if (state.status === 'pending') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13, color: 'var(--accent)' }}>
        <span className="animate-pulse">⏳</span> Transaction pending…
      </div>
    );
  }

  if (state.status === 'success') {
    const url = explorerUrl ? `${explorerUrl}${state.hash}` : null;
    const lzScanUrl = `https://layerzeroscan.com/tx/${state.hash}`;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--secondary)' }}>✓ Confirmed</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            View on Explorer ↗
          </a>
        )}
        {showLzScan && (
          <a href={lzScanUrl} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            LayerZero Scan ↗
          </a>
        )}
      </div>
    );
  }

  // error
  return (
    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--error)', lineHeight: 1.5 }}>
      ✗ {state.message.length > 200 ? state.message.slice(0, 200) + '…' : state.message}
    </div>
  );
}
