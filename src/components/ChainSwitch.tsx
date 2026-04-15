/** Unified chain-switch UI components used across all pages. */

interface SwitchChainButtonProps {
  chainName: string;
  onSwitch: () => void;
  size?: 'sm' | 'default';
}

/** Simple "Switch to {chain}" button, used inline wherever an action requires the right chain. */
export function SwitchChainButton({ chainName, onSwitch, size = 'sm' }: SwitchChainButtonProps): JSX.Element {
  return (
    <button className={`btn ${size === 'sm' ? 'btn-sm' : ''}`} onClick={onSwitch}>
      <span className="material-symbols-outlined text-sm">swap_horiz</span>
      Switch to {chainName}
    </button>
  );
}

interface WrongChainBannerProps {
  currentChainName: string;
  expectedChainName: string;
  onSwitch: () => void;
  /** Optional: allow the user to switch the page to match the wallet instead. */
  onUseWalletChain?: () => void;
}

/** Warning banner shown when wallet is on the wrong chain. Used by Timelock, Roles. */
export function WrongChainBanner({ currentChainName, expectedChainName, onSwitch, onUseWalletChain }: WrongChainBannerProps): JSX.Element {
  return (
    <div className="flex items-center gap-2 bg-tertiary/5 border border-tertiary/20 rounded-lg px-3 py-2 mb-4 text-xs text-tertiary">
      <span>Wallet is on {currentChainName}, selected is {expectedChainName}.</span>
      <button className="btn btn-sm" onClick={onSwitch}>Switch wallet</button>
      {onUseWalletChain && <button className="btn btn-sm" onClick={onUseWalletChain}>Use wallet chain</button>}
    </div>
  );
}

interface WalletChainHintProps {
  isConnected: boolean;
  isCorrectChain: boolean;
  chainName: string;
  onSwitch: () => void;
  variant?: 'evm' | 'starknet';
}

/** Inline connected indicator / switch prompt. Shows green dot when correct chain, switch button when wrong. */
export function WalletChainHint({ isConnected, isCorrectChain, chainName, onSwitch, variant = 'evm' }: WalletChainHintProps): JSX.Element | null {
  if (!isConnected) return null;
  if (isCorrectChain) {
    const colorClass = variant === 'starknet' ? 'text-tertiary' : 'text-secondary';
    const dotClass = variant === 'starknet' ? 'bg-tertiary' : 'bg-secondary';
    return (
      <span className={`flex items-center gap-1.5 text-xs ${colorClass}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
        {variant === 'starknet' ? 'Starknet connected' : `Wallet on ${chainName}`}
      </span>
    );
  }
  return <SwitchChainButton chainName={chainName} onSwitch={onSwitch} />;
}
