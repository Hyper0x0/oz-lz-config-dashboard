/**
 * TODO: implement when Cairo OFT contracts are deployed.
 */

interface Props {
  address: string | null;
  onConnect: () => Promise<void>;
}

export function StarknetWalletButton({ address, onConnect }: Props): JSX.Element {
  if (!address) {
    return (
      <button className="btn btn-stark" onClick={onConnect} disabled title="Cairo contracts pending">
        Connect ArgentX / Braavos (WIP)
      </button>
    );
  }

  return (
    <span className="badge badge-stark">
      Starknet — {address.slice(0, 6)}…{address.slice(-4)}
    </span>
  );
}
