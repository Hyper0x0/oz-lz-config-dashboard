import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import packageJson from '../package.json';
import { OFTWiring } from '@/pages/OFTWiring';
import { OFTs } from '@/pages/OFTs';
import { Timelock } from '@/pages/Timelock';
import { Roles } from '@/pages/Roles';
import { Settings } from '@/pages/Settings';
import { WalletProvider, useWallet } from '@/context/WalletContext';
import { ToastProvider } from '@/context/ToastContext';
import { ToastContainer } from '@/components/ToastContainer';
import { CommandPalette } from '@/components/CommandPalette';

const navClass = ({ isActive }: { isActive: boolean }) => isActive
  ? 'group relative flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-lg bg-primary/10 text-primary font-semibold tracking-wide border border-primary/20 shadow-[inset_0_0_18px_rgba(59,191,250,0.08)] transition-all before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary before:shadow-[0_0_8px_var(--accent)]'
  : 'group relative flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-lg text-on-surface-variant tracking-wide border border-transparent hover:bg-surface-container-high/60 hover:text-on-surface transition-all';

function Sidebar(): JSX.Element {
  return (
    <aside className="fixed left-0 top-0 flex flex-col h-screen w-72 flex-shrink-0 bg-surface-container-lowest/80 backdrop-blur-xl border-r border-[var(--hairline)] z-50">
      <div className="flex flex-col h-full py-6 px-4">
        {/* Brand */}
        <div className="mb-8 px-3">
          <div className="flex items-center gap-2 text-xl font-bold tracking-[0.04em] text-on-surface font-headline">
            <span className="text-primary">OZ</span>
            <span className="text-on-surface-variant/40 text-base font-normal">·</span>
            <span className="text-on-surface-variant">LZ</span>
            <span className="ml-1 w-1.5 h-1.5 rounded-full bg-secondary shadow-[0_0_6px_var(--secondary)] animate-pulse"></span>
          </div>
          <div className="text-[10px] text-on-surface-variant/70 mt-1 font-mono uppercase tracking-[0.22em]">Operator Console</div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 text-sm">
          <div className="pt-1 pb-2 px-3 flex items-center gap-2">
            <img src="/oz-logo.png" alt="OZ" className="w-6 h-6 rounded flex-shrink-0 object-contain" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-on-surface-variant/60 font-semibold">OpenZeppelin</span>
          </div>
          <NavLink to="/" end className={navClass}>
            <span className="material-symbols-outlined text-lg">lock_clock</span>
            TimeLock
          </NavLink>
          <NavLink to="/roles" className={navClass}>
            <span className="material-symbols-outlined text-lg">admin_panel_settings</span>
            Roles
          </NavLink>

          <div className="pt-5 pb-2 px-3 flex items-center gap-2">
            <img src="/lz-logo.webp" alt="LZ" className="w-7 h-7 rounded flex-shrink-0 object-contain" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-on-surface-variant/60 font-semibold">LayerZero</span>
          </div>
          <NavLink to="/wiring" className={navClass}>
            <span className="material-symbols-outlined text-lg">hub</span>
            OApp Wiring
          </NavLink>
          <NavLink to="/ofts" className={navClass}>
            <span className="material-symbols-outlined text-lg">swap_horiz</span>
            OFT Bridge
          </NavLink>

          <div className="pt-5 pb-2 px-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[12px] text-on-surface-variant/40">settings</span>
            <span className="text-[10px] uppercase tracking-[0.15em] text-on-surface-variant/60 font-semibold">System</span>
          </div>
          <NavLink to="/settings" className={navClass}>
            <span className="material-symbols-outlined text-lg">tune</span>
            Settings
          </NavLink>
        </nav>

        {/* Security banner */}
        <div className="security-banner mt-4 mx-1">
          <span className="material-symbols-outlined text-sm flex-shrink-0">shield</span>
          <span>Local use only</span>
        </div>

        {/* Version */}
        <div className="mt-3 px-3 text-[10px] text-on-surface-variant/40 font-mono">
          v{packageJson.version}
        </div>
      </div>
    </aside>
  );
}

function HeaderWallets(): JSX.Element {
  const { evm, stark } = useWallet();
  return (
    <div className="flex items-center gap-2">
      {/* EVM wallet */}
      {evm.address ? (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/15">
          <span className="w-2 h-2 rounded-full bg-secondary"></span>
          <span className="font-mono text-[11px] text-on-surface">{evm.address.slice(0,6)}...{evm.address.slice(-4)}</span>
        </div>
      ) : (
        <button onClick={() => evm.connect().catch(() => {})} className="btn btn-sm font-semibold">
          <span className="material-symbols-outlined text-sm">account_balance_wallet</span>
          Connect EVM
        </button>
      )}
      {/* Starknet wallet */}
      {stark.address ? (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg border border-tertiary/15">
          <span className="w-2 h-2 rounded-full bg-tertiary"></span>
          <span className="font-mono text-[11px] text-tertiary">{stark.address.slice(0,8)}...{stark.address.slice(-4)}</span>
          <button onClick={() => stark.disconnect().catch(() => {})} className="text-on-surface-variant hover:text-error transition-colors ml-1 text-xs">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      ) : (
        <button onClick={() => stark.connect().catch(() => {})} className="btn btn-sm btn-stark font-semibold">
          <span className="w-3 h-3 rounded-sm bg-tertiary/20 border border-tertiary/40 inline-flex items-center justify-center text-[7px] text-tertiary font-bold">S</span>
          Connect Starknet
        </button>
      )}
    </div>
  );
}

function PageTitle(): JSX.Element {
  const loc = useLocation();
  if (loc.pathname === '/roles') return <><span className="text-on-surface-variant font-normal">OpenZeppelin</span> <span className="text-on-surface-variant/40 mx-1">/</span> <span className="text-on-surface">Roles</span></>;
  if (loc.pathname === '/wiring') return <><span className="text-on-surface-variant font-normal">LayerZero</span> <span className="text-on-surface-variant/40 mx-1">/</span> <span className="text-on-surface">OApp Wiring</span></>;
  if (loc.pathname === '/ofts') return <><span className="text-on-surface-variant font-normal">LayerZero</span> <span className="text-on-surface-variant/40 mx-1">/</span> <span className="text-on-surface">OFT Bridge</span></>;
  if (loc.pathname === '/settings') return <><span className="text-on-surface-variant font-normal">System</span> <span className="text-on-surface-variant/40 mx-1">/</span> <span className="text-on-surface">Settings</span></>;
  return <><span className="text-on-surface-variant font-normal">OpenZeppelin</span> <span className="text-on-surface-variant/40 mx-1">/</span> <span className="text-on-surface">TimeLock</span></>;
}

function PaletteTrigger(): JSX.Element {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('ozlz:open-palette'))}
      className="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface-container/60 border border-outline-variant/15 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-xs"
      title="Open command palette"
      aria-label="Open command palette"
    >
      <span className="material-symbols-outlined text-sm">search</span>
      <span>Jump to…</span>
      <span className="ml-2 flex items-center gap-0.5 font-mono text-[10px] text-on-surface-variant/70">
        <kbd className="px-1 py-0.5 rounded border border-outline-variant/30 bg-surface-container">{isMac ? '⌘' : 'Ctrl'}</kbd>
        <kbd className="px-1 py-0.5 rounded border border-outline-variant/30 bg-surface-container">K</kbd>
      </span>
    </button>
  );
}

function TopBar(): JSX.Element {
  return (
    <header className="fixed top-0 right-0 left-72 h-16 flex items-center justify-between px-8 z-40 bg-surface-container-lowest/60 backdrop-blur-2xl border-b border-[var(--hairline)]">
      <h1 className="font-headline text-sm font-semibold tracking-tight flex items-center gap-3">
        <span className="material-symbols-outlined text-primary text-base">terminal</span>
        <PageTitle />
      </h1>
      <div className="flex items-center gap-3">
        <PaletteTrigger />
        <HeaderWallets />
      </div>
    </header>
  );
}

function AppShell(): JSX.Element {
  const loc = useLocation();
  return (
    <div className="text-on-surface font-body min-h-screen">
      <Sidebar />
      <TopBar />
      <main className="ml-72 mt-16 pb-8 min-h-screen">
        <div key={loc.pathname} className="route-enter p-8">
          <Routes location={loc}>
            <Route path="/"         element={<Timelock />} />
            <Route path="/roles"    element={<Roles />} />
            <Route path="/wiring"   element={<OFTWiring />} />
            <Route path="/ofts"     element={<OFTs />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <ToastProvider>
        <WalletProvider>
          <AppShell />
          <CommandPalette />
          <ToastContainer />
        </WalletProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
