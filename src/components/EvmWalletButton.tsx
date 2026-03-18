interface Props {
  address: string | null;
  chainId: number | null;
  chainName?: string;
  onConnect: () => Promise<void>;
  onSwitchNetwork?: () => Promise<void>;
  targetChainId?: number;
}

export function EvmWalletButton({
  address,
  chainId,
  chainName,
  onConnect,
  onSwitchNetwork,
  targetChainId,
}: Props): JSX.Element {
  const isWrongChain = targetChainId !== undefined && chainId !== null && chainId !== targetChainId;

  if (!address) {
    return (
      <button className="btn" onClick={onConnect}>
        Connect MetaMask
      </button>
    );
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="badge">
        {chainName ?? `chainId:${chainId}`} — {address.slice(0, 6)}…{address.slice(-4)}
      </span>
      {isWrongChain && onSwitchNetwork && (
        <button className="btn btn-warn" onClick={onSwitchNetwork}>
          Switch to {chainName}
        </button>
      )}
    </span>
  );
}
