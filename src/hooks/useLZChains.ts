import { useState, useEffect } from 'react';
import { LZ_CHAINS, filteredChains } from '@/config/lzCatalog';
import type { LZChain, ChainDefaults } from '@/config/lzCatalog';
import { getEvmRpc } from '@/pages/Settings';

const METADATA_URL = 'https://metadata.layerzero-api.com/v1/metadata';

// V2 EIDs: mainnet 30xxx, testnet 40xxx
const V2_EID_THRESHOLD = 30000;

// Ethereum mainnet EID
const ETH_EID = 30101;

const ETH_DEFAULTS: ChainDefaults  = { confirmations: 15, requiredDVNs: 2, gasLimit: 65000,  rateLimitValue: '0', rateLimitWindow: 3600 };
const L2_DEFAULTS: ChainDefaults   = { confirmations: 20, requiredDVNs: 2, gasLimit: 80000,  rateLimitValue: '0', rateLimitWindow: 3600 };
const TEST_DEFAULTS: ChainDefaults = { confirmations: 1,  requiredDVNs: 1, gasLimit: 80000,  rateLimitValue: '0', rateLimitWindow: 60 };

interface RawDeployment {
  eid?: string | number;
  endpointV2?: { address?: string };
  executor?: { address?: string };
  sendUln302?: { address?: string };
  receiveUln302?: { address?: string };
}

interface RawChain {
  environment?: string;
  chainDetails?: { chainKey?: string; nativeChainId?: number };
  deployments?: RawDeployment[];
  rpcs?: { url?: string }[];
}

type RawMetadata = Record<string, RawChain | undefined>;

let _cache: LZChain[] | null = null;
let _pending: Promise<LZChain[]> | null = null;

/** Drops the in-memory chain cache. Used by Settings after persisting RPC overrides. */
export function clearLZChainsCache(): void {
  _cache = null;
  _pending = null;
}

async function fetchChains(): Promise<LZChain[]> {
  if (_cache) return _cache;
  if (_pending) return _pending;

  _pending = fetch(METADATA_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Metadata API ${r.status}`);
      return r.json() as Promise<RawMetadata>;
    })
    .then((raw) => {
      const chains: LZChain[] = [];
      // Index static catalog by EID for fallback RPC lookup
      const staticByEid = Object.fromEntries(LZ_CHAINS.map((c) => [c.eid, c]));

      for (const [chainKey, entry] of Object.entries(raw)) {
        if (!entry) continue;
        const env = entry.environment;
        if (env !== 'mainnet' && env !== 'testnet') continue;

        const chainId = entry.chainDetails?.nativeChainId;
        if (!chainId || chainId <= 0) continue;

        // Find the V2 deployment
        const v2 = entry.deployments?.find((d) => {
          const eid = Number(d.eid ?? 0);
          return eid >= V2_EID_THRESHOLD && !!d.endpointV2?.address;
        });
        if (!v2) continue;

        const eid = Number(v2.eid);
        const apiEndpoint = v2.endpointV2?.address;
        if (!apiEndpoint) continue;

        // Skip non-EVM (addresses won't be 0x hex)
        if (!apiEndpoint.startsWith('0x')) continue;

        // If the API returns a non-standard endpoint, fall back to the known static entry.
        // All LZ V2 EVM chains use the same endpoint address.
        const staticEntry = staticByEid[eid];
        const endpoint = staticEntry?.endpoint ?? apiEndpoint;

        // Resolution order: user override (Settings) → static catalog → metadata API.
        // Static beats metadata because the metadata API often returns rate-limited public endpoints.
        const apiRpc = entry.rpcs?.find((r) => r.url)?.url ?? '';
        const baseRpc = staticEntry?.rpc || apiRpc;
        const rpc = getEvmRpc(chainId, baseRpc);
        if (!rpc) continue;

        const displayName = chainKey
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        const isTest = env === 'testnet';
        chains.push({
          eid,
          chainId,
          chainKey,
          name: displayName,
          endpoint,
          rpc,
          // Inherit fallback RPC from static catalog for known chains
          rpcFallback: staticEntry?.rpcFallback,
          isTestnet: isTest,
          executor: v2.executor?.address,
          sendLib: v2.sendUln302?.address,
          receiveLib: v2.receiveUln302?.address,
          defaults: staticEntry?.defaults ?? (isTest ? TEST_DEFAULTS : eid === ETH_EID ? ETH_DEFAULTS : L2_DEFAULTS),
        });
      }

      // Sort: mainnet first, then by EID
      chains.sort((a, b) => {
        if (a.isTestnet !== b.isTestnet) return a.isTestnet ? 1 : -1;
        return a.eid - b.eid;
      });

      _cache = chains;
      _pending = null;
      return chains;
    })
    .catch(() => {
      _pending = null;
      // Fallback to static catalog (already has executor/lib undefined)
      return LZ_CHAINS;
    });

  return _pending;
}

interface LZChainsState {
  allChains: LZChain[];
  chains: LZChain[];          // filtered by isTestnet flag
  loading: boolean;
  isTestnet: boolean;
  setIsTestnet: (v: boolean) => void;
}

export function useLZChains(defaultTestnet = true): LZChainsState {
  const [allChains, setAllChains] = useState<LZChain[]>(LZ_CHAINS);
  const [loading, setLoading] = useState(true);
  const [isTestnet, setIsTestnet] = useState(defaultTestnet);

  useEffect(() => {
    let cancelled = false;
    function load(): void {
      setLoading(true);
      fetchChains().then((c) => {
        if (cancelled) return;
        setAllChains(c);
        setLoading(false);
      });
    }
    load();
    function onRpcChanged(): void {
      clearLZChainsCache();
      load();
    }
    window.addEventListener('ozlz:rpc-changed', onRpcChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('ozlz:rpc-changed', onRpcChanged);
    };
  }, []);

  // While API is loading, use static catalog as placeholder
  const source = loading ? filteredChains(isTestnet) : allChains.filter((c) => c.isTestnet === isTestnet);

  return { allChains, chains: source, loading, isTestnet, setIsTestnet };
}
