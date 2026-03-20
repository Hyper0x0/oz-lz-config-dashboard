import { useState, useEffect, useRef } from 'react';
import type { DVNProvider } from '@/types';

/**
 * Endpoint: https://metadata.layerzero-api.com/v1/metadata/dvns
 *
 * Actual response shape (keyed by chain name, NOT by DVN name):
 *   {
 *     "arbitrum": {
 *       "dvns": {
 *         "0xDeAd...": { "canonicalName": "LayerZero Labs", "version": 2, "id": "layerzero-labs" },
 *         "0xBeef...": { "canonicalName": "Nethermind", "version": 2 }
 *       }
 *     },
 *     "ethereum": { "dvns": { ... } }
 *   }
 */

const DVN_API = 'https://metadata.layerzero-api.com/v1/metadata/dvns';

// Colour palette for avatar initials — deterministic by provider name
const AVATAR_COLORS: Record<string, string> = {
  'LayerZero Labs':  '#5865f2',
  'Google Cloud':    '#4285f4',
  'Nethermind':      '#b958f5',
  'Polyhedra':       '#00c2ff',
  'Horizen Labs':    '#1cd8d2',
  'BitGo':           '#f5a623',
  'Bware Labs':      '#e86c2c',
  'Animoca Brands':  '#ff4e8a',
  'BlockPI':         '#2db07d',
  'Stargate':        '#6979f8',
};

function colorFor(name: string): string {
  // Exact match first, then prefix match for variants like "Horizen"
  if (name in AVATAR_COLORS) return AVATAR_COLORS[name]!;
  const key = Object.keys(AVATAR_COLORS).find((k) => name.startsWith(k.split(' ')[0]!));
  return key ? AVATAR_COLORS[key]! : '#888';
}

// ── Raw API types ─────────────────────────────────────────────────────────────

interface RawDVNMeta {
  canonicalName?: string;
  version?: number;
  id?: string;
  deprecated?: boolean;
  lzReadCompatible?: boolean;
}

interface RawChain {
  dvns?: Record<string, RawDVNMeta | undefined>;
}

type RawResponse = Record<string, RawChain | undefined>;

// ── Module-level cache ────────────────────────────────────────────────────────

let _cache: RawResponse | null = null;
let _pending: Promise<RawResponse> | null = null;

async function fetchRaw(): Promise<RawResponse> {
  if (_cache) return _cache;
  if (_pending) return _pending;
  _pending = fetch(DVN_API)
    .then((r) => {
      if (!r.ok) throw new Error(`DVN API ${r.status}`);
      return r.json() as Promise<RawResponse>;
    })
    .then((data) => {
      _cache = data;
      _pending = null;
      return data;
    })
    .catch((err: unknown) => {
      _pending = null;
      throw err;
    });
  return _pending;
}

function parseDVNsForChain(raw: RawResponse, chainKey: string): DVNProvider[] {
  const chainData = raw[chainKey];
  if (!chainData?.dvns) return [];

  const result: DVNProvider[] = [];
  for (const [address, meta] of Object.entries(chainData.dvns)) {
    if (!meta?.canonicalName || meta.deprecated) continue;
    // Skip LZ Read DVNs — they are for the Read protocol, not OFT messaging
    if (meta.lzReadCompatible) continue;
    result.push({
      name: meta.canonicalName,
      address,
      color: colorFor(meta.canonicalName),
    });
  }
  // Sort: known providers first, then alpha
  result.sort((a, b) => {
    const aKnown = a.color !== '#888' ? 0 : 1;
    const bKnown = b.color !== '#888' ? 0 : 1;
    return aKnown - bKnown || a.name.localeCompare(b.name);
  });
  return result;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

interface DVNCatalogState {
  dvns: DVNProvider[];
  loading: boolean;
  error: string | null;
  /** Resolve a contract address on a specific chain to its canonical name */
  resolveName: (address: string, chainKey?: string) => string | null;
}

export function useDVNCatalog(chainKey: string): DVNCatalogState {
  const [dvns, setDvns] = useState<DVNProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rawRef = useRef<RawResponse | null>(null);

  useEffect(() => {
    if (!chainKey) return;
    setLoading(true);
    setError(null);
    fetchRaw()
      .then((raw) => {
        rawRef.current = raw;
        setDvns(parseDVNsForChain(raw, chainKey));
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [chainKey]);

  function resolveName(address: string, forChainKey?: string): string | null {
    const raw = rawRef.current;
    if (!raw) return null;
    const key = forChainKey ?? chainKey;
    return raw[key]?.dvns?.[address]?.canonicalName ?? raw[key]?.dvns?.[address.toLowerCase()]?.canonicalName ?? null;
  }

  return { dvns, loading, error, resolveName };
}
