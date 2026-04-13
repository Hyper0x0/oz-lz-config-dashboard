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

// ── DVN Picker ──────────────────────────────────────────────────────────────

interface Props {
  chainKey: string;
  selected: Map<string, DVNProvider>;
  onToggle: (addr: string, provider: DVNProvider) => void;
}

export function DVNPicker({ chainKey, selected, onToggle }: Props): JSX.Element {
  const { dvns, loading, error } = useDVNCatalog(chainKey);
  const [query, setQuery] = useState('');
  const [manualAddr, setManualAddr] = useState('');

  const q = query.toLowerCase();
  const filtered = dvns.filter((p) =>
    p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
  );

  // Sort: selected first, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    const aSelected = selected.has(a.address.toLowerCase()) ? 0 : 1;
    const bSelected = selected.has(b.address.toLowerCase()) ? 0 : 1;
    if (aSelected !== bSelected) return aSelected - bSelected;
    return a.name.localeCompare(b.name);
  });

  /** Look up an address in the chain's DVN catalog so manually-pasted addresses still surface name + icon. */
  function resolveProvider(addr: string): DVNProvider {
    const found = dvns.find((d) => d.address.toLowerCase() === addr.toLowerCase());
    if (found) return found;
    return { name: addr.slice(0, 8) + '…' + addr.slice(-4), address: addr, color: '#666' };
  }

  function addManual(): void {
    const addr = manualAddr.trim().toLowerCase();
    if (!addr || addr.length < 10) return;
    if (selected.has(addr)) return;
    onToggle(addr, resolveProvider(addr));
    setManualAddr('');
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {/* Selected summary bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
        background: 'var(--bg)', borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap', minHeight: 36,
      }}>
        {selected.size === 0
          ? <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No DVNs selected</span>
          : [...selected.values()].map((p) => (
              <span key={p.address} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: p.color + '22', border: `1px solid ${p.color}55`,
                borderRadius: 4, padding: '2px 8px', fontSize: 11, color: 'var(--text)',
              }}>
                <DVNAvatar provider={p} size={14} />
                {p.name}
                <button onClick={() => onToggle(p.address.toLowerCase(), p)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: 13, padding: 0, marginLeft: 2, lineHeight: 1 }}>
                  ×
                </button>
              </span>
            ))
        }
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>
          {selected.size} selected
        </span>
      </div>

      {/* Search + manual add */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or paste address…"
          style={{ border: 'none', borderRadius: 0, flex: 1, fontSize: 12, height: 34 }} />
        <button className="btn btn-sm" disabled={!manualAddr.trim() && !query.trim()}
          onClick={() => {
            const addr = (manualAddr || query).trim();
            if (addr.startsWith('0x') && addr.length > 10) {
              onToggle(addr.toLowerCase(), resolveProvider(addr));
              setManualAddr(''); setQuery('');
            }
          }}
          style={{ borderRadius: 0, border: 'none', borderLeft: '1px solid var(--border)', height: 34, fontSize: 11 }}>
          + Add
        </button>
      </div>

      {/* DVN list */}
      <div style={{ maxHeight: 220, overflowY: 'auto', background: 'var(--bg-card)' }}>
        {loading && (
          <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
            Loading DVN catalog…
          </div>
        )}
        {error && (
          <div style={{ padding: '12px', color: 'var(--error)', fontSize: 12 }}>Error: {error}</div>
        )}
        {!loading && sorted.length === 0 && !error && (
          <div style={{ padding: '12px', color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>
            {dvns.length === 0 ? 'No catalog for this chain — use the Add button above' : 'No match'}
          </div>
        )}
        {sorted.map((p) => {
          const addr = p.address.toLowerCase();
          const checked = selected.has(addr);
          return (
            <div key={p.address}
              onClick={() => onToggle(addr, p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', cursor: 'pointer',
                background: checked ? p.color + '12' : 'transparent',
                borderBottom: '1px solid var(--border)',
                transition: 'background 100ms',
              }}
              onMouseEnter={(e) => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = checked ? p.color + '12' : 'transparent'; }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                border: checked ? `2px solid ${p.color}` : '2px solid var(--border-hover)',
                background: checked ? p.color : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 100ms',
              }}>
                {checked && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
              </span>
              <DVNAvatar provider={p} size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {p.address.slice(0, 10)}…{p.address.slice(-6)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
