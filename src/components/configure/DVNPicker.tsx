import { useState, useRef, useEffect } from 'react';
import { useDVNCatalog } from '@/hooks/useDVNCatalog';
import type { DVNProvider } from '@/types';

// ── DVN Avatar ──────────────────────────────────────────────────────────────

export function DVNAvatar({ provider, size = 20 }: { provider: DVNProvider; size?: number }): JSX.Element {
  const initials = provider.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const [imgFailed, setImgFailed] = useState(false);

  if (provider.icon && !imgFailed) {
    return (
      <img src={provider.icon} alt={provider.name} width={size} height={size}
        onError={() => setImgFailed(true)}
        className="rounded-full flex-shrink-0 object-cover" />
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%',
      background: provider.color + '33', border: `1px solid ${provider.color}`,
      color: provider.color, fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
    }}>
      {initials}
    </span>
  );
}

// ── DVN Chip (selected display) ─────────────────────────────────────────────

function DVNChip({ provider, onRemove }: { provider: DVNProvider; onRemove: () => void }): JSX.Element {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: provider.color + '22', border: `1px solid ${provider.color}66`,
      borderRadius: 4, padding: '1px 6px', fontSize: 11,
    }}>
      <DVNAvatar provider={provider} size={14} />
      {provider.name}
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0, marginLeft: 2 }}>
        ×
      </button>
    </span>
  );
}

// ── DVN Picker ──────────────────────────────────────────────────────────────

interface Props {
  chainKey: string;
  selected: Map<string, DVNProvider>;
  onToggle: (addr: string, provider: DVNProvider) => void;
  /** 'dropdown' = searchable popup, 'inline' = flat checkbox list, 'auto' = based on count */
  mode?: 'dropdown' | 'inline' | 'auto';
}

export function DVNPicker({ chainKey, selected, onToggle, mode = 'auto' }: Props): JSX.Element {
  const { dvns, loading, error } = useDVNCatalog(chainKey);
  const resolvedMode = mode === 'auto' ? (dvns.length <= 8 ? 'inline' : 'dropdown') : mode;

  if (loading) return <div className="text-xs text-[var(--text-muted)]">Loading DVNs…</div>;
  if (error) return <div className="text-xs text-[var(--error)]">Error: {error}</div>;
  if (dvns.length === 0) return <div className="text-xs text-[var(--text-muted)]">No DVNs found for this chain.</div>;

  if (resolvedMode === 'inline') {
    return <InlinePicker dvns={dvns} selected={selected} onToggle={onToggle} />;
  }
  return <DropdownPicker dvns={dvns} selected={selected} onToggle={onToggle} />;
}

// ── Inline mode (flat checkboxes) ───────────────────────────────────────────

function InlinePicker({ dvns, selected, onToggle }: {
  dvns: DVNProvider[]; selected: Map<string, DVNProvider>; onToggle: (addr: string, p: DVNProvider) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {dvns.map((p) => {
        const addr = p.address.toLowerCase();
        const checked = selected.has(addr);
        return (
          <label key={p.address} style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            padding: '6px 8px', borderRadius: 6,
            background: checked ? p.color + '15' : 'transparent',
            border: `1px solid ${checked ? p.color + '66' : 'rgba(64,72,93,0.3)'}`,
          }}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(addr, p)}
              style={{ accentColor: 'var(--accent)' }} />
            <DVNAvatar provider={p} size={22} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{p.name}</div>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {p.address.slice(0, 12)}…{p.address.slice(-6)}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ── Dropdown mode (searchable popup) ────────────────────────────────────────

function DropdownPicker({ dvns, selected, onToggle }: {
  dvns: DVNProvider[]; selected: Map<string, DVNProvider>; onToggle: (addr: string, p: DVNProvider) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setQuery('');
  }, [open]);

  const selectedList = [...selected.values()];
  const filtered = dvns.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="input dvn-trigger" onClick={() => setOpen((o) => !o)} type="button"
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
        {selectedList.length === 0
          ? <span style={{ color: 'var(--text-dim)' }}>Select DVNs…</span>
          : <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              {selectedList.map((p) => (
                <DVNChip key={p.address} provider={p}
                  onRemove={() => onToggle(p.address.toLowerCase(), p)} />
              ))}
            </span>
        }
        <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="dvn-dropdown-list">
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input ref={inputRef} className="input" placeholder="Search DVNs…"
              value={query} onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()} style={{ padding: '5px 8px' }} />
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: '8px 12px', color: 'var(--text-dim)', fontSize: 13 }}>
              {dvns.length === 0 ? 'No DVNs for this chain' : 'No DVNs match'}
            </div>
          )}
          {filtered.map((p) => {
            const addr = p.address.toLowerCase();
            const checked = selected.has(addr);
            return (
              <label key={p.address} className="dvn-option">
                <input type="checkbox" checked={checked}
                  onChange={() => onToggle(addr, p)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ accentColor: 'var(--accent)' }} />
                <DVNAvatar provider={p} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{p.address.slice(0, 12)}…{p.address.slice(-6)}</div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
