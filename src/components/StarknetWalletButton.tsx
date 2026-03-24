interface Props {
  address: string | null;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function StarknetWalletButton({ address, onConnect, onDisconnect }: Props): JSX.Element {
  if (!address) {
    return (
      <button className="btn btn-stark" onClick={onConnect}>
        Connect Starknet
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 10px', background: '#1a0e0a', border: '1px solid #3a2010', borderRadius: 6, fontSize: 12 }}>
      <span style={{ color: '#ff7e33' }}>Starknet</span>
      <span style={{ fontFamily: 'monospace', color: '#aaa' }}>{address.slice(0, 8)}…{address.slice(-4)}</span>
      <button className="btn" style={{ fontSize: 11, padding: '1px 6px' }} onClick={onDisconnect}>✕</button>
    </div>
  );
}
