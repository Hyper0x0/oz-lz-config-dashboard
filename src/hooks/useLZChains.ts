import { useState, useEffect } from 'react';
import { LZ_CHAINS, filteredChains } from '@/config/lzCatalog';
import type { LZChain } from '@/config/lzCatalog';

const METADATA_URL = 'https://metadata.layerzero-api.com/v1/metadata';

// V2 EIDs: mainnet 30xxx, testnet 40xxx
const V2_EID_THRESHOLD = 30000;

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
        const endpoint = v2.endpointV2?.address;
        if (!endpoint) continue;

        // Skip non-EVM (addresses won't be 0x hex)
        if (!endpoint.startsWith('0x')) continue;

        const rpc = entry.rpcs?.find((r) => r.url)?.url ?? '';
        if (!rpc) continue;

        const displayName = chainKey
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        chains.push({
          eid,
          chainId,
          chainKey,
          name: displayName,
          endpoint,
          rpc,
          isTestnet: env === 'testnet',
          executor: v2.executor?.address,
          sendLib: v2.sendUln302?.address,
          receiveLib: v2.receiveUln302?.address,
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
    setLoading(true);
    fetchChains().then((c) => {
      setAllChains(c);
      setLoading(false);
    });
  }, []);

  // While API is loading, use static catalog as placeholder
  const source = loading ? filteredChains(isTestnet) : allChains.filter((c) => c.isTestnet === isTestnet);

  return { allChains, chains: source, loading, isTestnet, setIsTestnet };
}
