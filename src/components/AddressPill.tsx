import { useState } from 'react';

const CHAIN_ICONS: Record<number, string> = {
  1:        'ethereum',
  42161:    'arbitrum',
  421614:   'arbitrum',
  10:       'optimism',
  11155420: 'optimism',
  8453:     'base',
  84532:    'base',
  137:      'polygon',
  56:       'binance',
  43114:    'avax',
  11155111: 'ethereum',
};

function evmChainIconUrl(chainId: number): string {
  const name = CHAIN_ICONS[chainId] ?? 'ethereum';
  return `https://icons.llamao.fi/icons/chains/rsz_${name}.jpg`;
}

interface Props {
  /** Hex address. Renders truncated; full value available via tooltip + clipboard. */
  address: string;
  /** EVM = chain-specific icon; Starknet = tertiary "S" badge; null = no badge. */
  chain?: 'evm' | 'starknet' | null;
  /** EVM chain id for picking the right icon. Ignored when chain !== 'evm'. */
  chainId?: number;
  /** Base URL (with trailing slash) for the explorer; address is appended. */
  explorerUrl?: string;
  /** Hex chars to keep on each side of the ellipsis. Defaults differ by chain (EVM 6/4, Starknet 8/6). */
  truncate?: { start: number; end: number };
  /** Optional caption rendered above the address (e.g. "Target", "From"). */
  label?: string;
  /** `sm` shrinks padding + font. */
  size?: 'sm' | 'md';
  className?: string;
}

/** A compact, copyable address chip with chain context. Click anywhere to copy. */
export function AddressPill({
  address,
  chain = null,
  chainId,
  explorerUrl,
  truncate,
  label,
  size = 'md',
  className,
}: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  const defaults = chain === 'starknet' ? { start: 8, end: 6 } : { start: 6, end: 4 };
  const { start, end } = truncate ?? defaults;
  const display = address.length > start + end + 2
    ? `${address.slice(0, start)}…${address.slice(-end)}`
    : address;

  async function copy(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* silently no-op */ }
  }

  const padCls = size === 'sm' ? 'px-2 py-0.5 gap-1.5 text-[11px]' : 'px-2.5 py-1 gap-2 text-xs';

  return (
    <div className={`inline-flex flex-col ${className ?? ''}`}>
      {label && (
        <span className="label">{label}</span>
      )}
      <span
        className={`inline-flex items-center ${padCls} rounded-full bg-surface-container border border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-high transition-colors group`}
        title={address}
      >
        {chain === 'evm' && (
          <img
            src={evmChainIconUrl(chainId ?? 1)}
            alt=""
            width={size === 'sm' ? 12 : 14}
            height={size === 'sm' ? 12 : 14}
            className="rounded-full flex-shrink-0 object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {chain === 'starknet' && (
          <span
            className={`${size === 'sm' ? 'w-3 h-3 text-[7px]' : 'w-3.5 h-3.5 text-[8px]'} rounded-sm bg-tertiary/20 border border-tertiary/40 inline-flex items-center justify-center text-tertiary font-bold flex-shrink-0`}
            aria-label="Starknet"
          >
            S
          </span>
        )}

        <button
          type="button"
          onClick={copy}
          className="font-mono text-on-surface hover:text-primary transition-colors cursor-pointer bg-transparent border-0 p-0"
          title={copied ? 'Copied' : 'Click to copy'}
        >
          {display}
        </button>

        <button
          type="button"
          onClick={copy}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-primary bg-transparent border-0 p-0 leading-none flex items-center"
          aria-label={copied ? 'Copied' : 'Copy address'}
          title={copied ? 'Copied' : 'Copy address'}
        >
          <span className="material-symbols-outlined" style={{ fontSize: size === 'sm' ? 12 : 14 }}>
            {copied ? 'check' : 'content_copy'}
          </span>
        </button>

        {explorerUrl && (
          <a
            href={explorerUrl + address}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-primary leading-none flex items-center"
            aria-label="Open in block explorer"
            title="Open in block explorer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: size === 'sm' ? 12 : 14 }}>open_in_new</span>
          </a>
        )}
      </span>
    </div>
  );
}
