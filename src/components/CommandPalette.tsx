import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';

interface Command {
  id: string;
  /** Short label shown in the list. */
  label: string;
  /** Optional secondary text (e.g. current route, hint). */
  hint?: string;
  /** Material Symbols icon name. */
  icon: string;
  /** Group label for visual separation. */
  group: string;
  /** Extra words that should match the query but aren't shown. */
  keywords?: string[];
  /** Hidden when false — used for context-sensitive commands. */
  available?: boolean;
  run: () => void | Promise<void>;
}

function score(query: string, cmd: Command): number {
  if (!query) return 1; // everything matches an empty query
  const q = query.toLowerCase();
  const haystacks = [cmd.label, cmd.hint ?? '', cmd.group, ...(cmd.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  if (haystacks.includes(q)) {
    // earlier match in the label = higher score
    const labelIdx = cmd.label.toLowerCase().indexOf(q);
    if (labelIdx === 0) return 1000;
    if (labelIdx > 0)   return 500 - labelIdx;
    return 100;
  }
  // letter-by-letter fuzzy match
  let i = 0;
  for (const ch of haystacks) {
    if (ch === q[i]) i++;
    if (i === q.length) return 50;
  }
  return 0;
}

export function CommandPalette(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { evm, stark } = useWallet();
  const toast = useToast();

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  // ── Global keybind: ⌘K / Ctrl+K ─────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    }
    function onCustom(): void { setOpen((o) => !o); }
    window.addEventListener('keydown', onKey);
    window.addEventListener('ozlz:open-palette', onCustom);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('ozlz:open-palette', onCustom);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) {
      // wait for the input to mount, then focus
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ── Catalog ─────────────────────────────────────────────────────────────
  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => { navigate(path); close(); };
    const run = (label: string, fn: () => void | Promise<void>) => async () => {
      try { await fn(); } catch (e) {
        toast.error(`${label} failed`, e instanceof Error ? e.message : String(e));
      } finally { close(); }
    };

    return [
      { id: 'go-timelock', group: 'Navigate', icon: 'lock_clock',           label: 'Timelock',    hint: '/',         keywords: ['oz', 'openzeppelin', 'schedule', 'execute'], run: go('/') },
      { id: 'go-roles',    group: 'Navigate', icon: 'admin_panel_settings', label: 'Roles',       hint: '/roles',    keywords: ['access', 'permissions', 'grant', 'revoke'],   run: go('/roles') },
      { id: 'go-wiring',   group: 'Navigate', icon: 'hub',                  label: 'OApp Wiring', hint: '/wiring',   keywords: ['layerzero', 'lz', 'config', 'peer', 'dvn'],    run: go('/wiring') },
      { id: 'go-ofts',     group: 'Navigate', icon: 'swap_horiz',           label: 'OFT Bridge',  hint: '/ofts',     keywords: ['send', 'bridge', 'transfer', 'token'],         run: go('/ofts') },
      { id: 'go-settings', group: 'Navigate', icon: 'tune',                 label: 'Settings',    hint: '/settings', keywords: ['rpc', 'api', 'key', 'override'],               run: go('/settings') },

      {
        id: 'wallet-connect-evm', group: 'Wallets', icon: 'account_balance_wallet',
        label: 'Connect EVM wallet',
        hint: evm.address ? `connected · ${evm.address.slice(0,6)}…${evm.address.slice(-4)}` : 'MetaMask / browser injected',
        available: !evm.address,
        keywords: ['metamask', 'ethereum', 'evm'],
        run: run('EVM wallet', () => evm.connect()),
      },
      {
        id: 'wallet-connect-stark', group: 'Wallets', icon: 'rocket_launch',
        label: stark.address ? 'Disconnect Starknet wallet' : 'Connect Starknet wallet',
        hint: stark.address ? `${stark.address.slice(0,8)}…${stark.address.slice(-4)}` : 'ArgentX / Braavos',
        keywords: ['argent', 'braavos', 'cairo'],
        run: run('Starknet wallet', () => stark.address ? stark.disconnect() : stark.connect()),
      },

      {
        id: 'copy-evm-address', group: 'Quick actions', icon: 'content_copy',
        label: 'Copy EVM address',
        hint: evm.address ?? undefined,
        available: !!evm.address,
        run: run('Copy', async () => {
          await navigator.clipboard.writeText(evm.address!);
          toast.success('EVM address copied');
        }),
      },
      {
        id: 'copy-stark-address', group: 'Quick actions', icon: 'content_copy',
        label: 'Copy Starknet address',
        hint: stark.address ?? undefined,
        available: !!stark.address,
        run: run('Copy', async () => {
          await navigator.clipboard.writeText(stark.address!);
          toast.success('Starknet address copied');
        }),
      },
      {
        id: 'reload', group: 'Quick actions', icon: 'refresh',
        label: 'Reload application', keywords: ['refresh', 'restart'],
        run: () => window.location.reload(),
      },
    ].filter((c) => c.available !== false);
  }, [navigate, evm, stark, toast, close]);

  const filtered = useMemo(() => {
    const ranked = commands
      .map((c) => ({ c, s: score(query, c) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
    return ranked;
  }, [commands, query]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  // Group while preserving order from the ranked list.
  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const onKeyDown = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) void cmd.run();
    }
  }, [filtered, activeIndex]);

  if (!open) return null;

  let flatIdx = -1;
  return (
    <div className="cmdk-overlay" onClick={close} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-search-row">
          <span className="material-symbols-outlined cmdk-search-icon">search</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type a command, page, or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmdk-esc">esc</kbd>
        </div>

        <div className="cmdk-list" role="listbox">
          {filtered.length === 0 && (
            <div className="cmdk-empty">No matches for “{query}”.</div>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} className="cmdk-group">
              <div className="cmdk-group-title">{group}</div>
              {items.map((c) => {
                flatIdx++;
                const active = flatIdx === activeIndex;
                return (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={active}
                    className={`cmdk-item${active ? ' cmdk-item-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onClick={() => void c.run()}
                  >
                    <span className="material-symbols-outlined cmdk-item-icon">{c.icon}</span>
                    <span className="cmdk-item-label">{c.label}</span>
                    {c.hint && <span className="cmdk-item-hint">{c.hint}</span>}
                    {active && <span className="cmdk-enter">↵</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
          <span className="ml-auto cmdk-footer-hint">Currently on {location.pathname}</span>
        </div>
      </div>
    </div>
  );
}
