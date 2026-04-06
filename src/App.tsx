import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import packageJson from '../package.json';
import { OFTWiring } from '@/pages/OFTWiring';
import { Timelock } from '@/pages/Timelock';
import { Roles } from '@/pages/Roles';
import { Settings } from '@/pages/Settings';
import { WalletProvider, useWallet } from '@/context/WalletContext';

function Sidebar(): JSX.Element {
  return (
    <aside className="fixed left-0 top-0 flex flex-col h-screen w-64 flex-shrink-0 bg-surface border-r border-outline-variant/15 z-50">
      <div className="flex flex-col h-full py-6 px-4">
        <div className="mb-8 px-2">
          <div className="text-lg font-bold tracking-tighter text-primary font-headline">OZLZ - Configurator</div>
          <div className="text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5 font-headline opacity-60">Technical Engine</div>
        </div>
        <nav className="flex-1 space-y-1 font-headline text-sm tracking-tight">
          <div className="pt-2 pb-2 px-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-outline-variant font-bold">OpenZeppelin</span>
          </div>
          <NavLink to="/" end className={({ isActive }) => isActive
            ? 'flex items-center gap-3 px-4 py-2 rounded bg-surface-container-highest text-primary font-bold border-r-2 border-primary'
            : 'flex items-center gap-3 px-4 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors'}>
            <span className="material-symbols-outlined text-lg">security</span>
            TimeLock
          </NavLink>
          <NavLink to="/roles" className={({ isActive }) => isActive
            ? 'flex items-center gap-3 px-4 py-2 rounded bg-surface-container-highest text-primary font-bold border-r-2 border-primary'
            : 'flex items-center gap-3 px-4 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors'}>
            <span className="material-symbols-outlined text-lg">shield_person</span>
            Roles
          </NavLink>
          <div className="pt-4 pb-2 px-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-outline-variant font-bold">LayerZero</span>
          </div>
          <NavLink to="/wiring" className={({ isActive }) => isActive
            ? 'flex items-center gap-3 px-4 py-2 rounded bg-surface-container-highest text-primary font-bold border-r-2 border-primary'
            : 'flex items-center gap-3 px-4 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors'}>
            <span className="material-symbols-outlined text-lg">layers</span>
            OFT Config
          </NavLink>
          <div className="mt-8 border-t border-outline-variant/10 pt-4">
            <NavLink to="/settings" className={({ isActive }) => isActive
              ? 'flex items-center gap-3 px-4 py-2 rounded bg-surface-container-highest text-primary font-bold border-r-2 border-primary'
              : 'flex items-center gap-3 px-4 py-2 rounded text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors'}>
              <span className="material-symbols-outlined text-lg">settings</span>
              Settings
            </NavLink>
          </div>
        </nav>
      </div>
    </aside>
  );
}

function HeaderWallets(): JSX.Element {
  const { evm, stark } = useWallet();
  const loc = useLocation();
  const isWiring = loc.pathname === '/wiring';
  return (
    <div className="flex items-center gap-2">
      {/* EVM wallet */}
      {evm.address ? (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded border border-outline-variant/20">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
          <span className="font-mono text-[11px] text-on-surface">{evm.address.slice(0,6)}…{evm.address.slice(-4)}</span>
        </div>
      ) : (
        <button onClick={() => evm.connect().catch(() => {})} className="px-4 py-1.5 bg-gradient-to-br from-primary to-primary-container text-on-primary-container font-headline text-xs font-bold uppercase tracking-wider rounded shadow-lg shadow-primary/10 hover:opacity-90 transition-all active:scale-[0.99]">
          Connect EVM
        </button>
      )}
      {/* Starknet wallet — only on wiring page */}
      {isWiring && (
        stark.address ? (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded border border-tertiary/20">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
            <span className="font-mono text-[11px] text-tertiary">{stark.address.slice(0,8)}…{stark.address.slice(-4)}</span>
            <button onClick={() => stark.disconnect().catch(() => {})} className="text-on-surface-variant hover:text-error transition-colors ml-1 text-xs">✕</button>
          </div>
        ) : (
          <button onClick={() => stark.connect().catch(() => {})} className="px-4 py-1.5 bg-surface-container border border-tertiary/30 text-tertiary font-headline text-xs font-bold uppercase tracking-wider rounded hover:bg-tertiary/5 transition-all">
            Connect Starknet
          </button>
        )
      )}
    </div>
  );
}

function PageTitle(): JSX.Element {
  const loc = useLocation();
  if (loc.pathname === '/roles') return <><span className="text-on-surface-variant font-normal">OpenZeppelin /</span> <span className="text-primary">Roles</span></>;
  if (loc.pathname === '/wiring') return <><span className="text-on-surface-variant font-normal">LayerZero /</span> <span className="text-primary">OFT Config</span></>;
  if (loc.pathname === '/settings') return <><span className="text-on-surface-variant font-normal">System /</span> <span className="text-primary">Settings</span></>;
  return <><span className="text-on-surface-variant font-normal">OpenZeppelin /</span> <span className="text-primary">TimeLock</span></>;
}

function TopBar(): JSX.Element {
  return (
    <header className="fixed top-0 right-0 left-64 h-16 flex items-center justify-between px-8 z-40 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/15">
      <h1 className="font-headline text-base font-bold tracking-tight text-on-surface">
        <PageTitle />
      </h1>
      <HeaderWallets />
    </header>
  );
}

function Footer(): JSX.Element {
  return (
    <footer className="fixed bottom-0 right-0 left-64 px-8 flex items-center gap-4 border-t border-outline-variant/10 h-10 bg-surface z-50">
      <span className="font-mono text-[10px] uppercase tracking-widest text-outline-variant">v{packageJson.version}</span>
    </footer>
  );
}

function AppShell(): JSX.Element {
  return (
    <div className="bg-surface text-on-surface font-body min-h-screen">
      <Sidebar />
      <TopBar />
      <main className="ml-64 mt-16 pb-12 min-h-screen">
        <div className="p-8">
          <Routes>
            <Route path="/"         element={<Timelock />} />
            <Route path="/roles"    element={<Roles />} />
            <Route path="/wiring"   element={<OFTWiring />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <WalletProvider>
        <AppShell />
      </WalletProvider>
    </BrowserRouter>
  );
}
