const CHAIN_ICONS: Record<number, string> = {
  1:        'ethereum',
  42161:    'arbitrum',
  421614:   'arbitrum',
  10:       'optimism',
  8453:     'base',
  84532:    'base',
  137:      'polygon',
  56:       'binance',
  43114:    'avax',
  11155111: 'ethereum',
};

function chainIconUrl(chainId: number): string {
  const name = CHAIN_ICONS[chainId] ?? 'ethereum';
  return `https://icons.llamao.fi/icons/chains/rsz_${name}.jpg`;
}

interface ChainBadgeProps {
  chainId: number;
  chainName: string;
  /** 'connected' = green dot, 'warning' = yellow, 'disconnected' = grey */
  status?: 'connected' | 'warning' | 'disconnected';
  size?: 'sm' | 'md';
}

export function ChainBadge({ chainId, chainName, status = 'connected', size = 'md' }: ChainBadgeProps): JSX.Element {
  const dotColor = status === 'connected' ? 'bg-secondary' : status === 'warning' ? 'bg-tertiary' : 'bg-outline-variant';
  const isSm = size === 'sm';

  return (
    <div className={`inline-flex items-center gap-2 ${isSm ? 'text-[11px]' : 'text-xs'}`}>
      <img
        src={chainIconUrl(chainId)}
        alt=""
        width={isSm ? 14 : 18}
        height={isSm ? 14 : 18}
        className="rounded-full flex-shrink-0 object-cover"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
      <span className="font-semibold text-on-surface">{chainName}</span>
    </div>
  );
}
