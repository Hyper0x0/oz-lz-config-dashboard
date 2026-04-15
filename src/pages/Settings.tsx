import { useState, useEffect } from 'react';
import packageJson from '../../package.json';
import { Section } from '@/components/Section';

const STORAGE_KEY = 'ozlz_rpc_overrides';
const API_KEY_STORAGE = 'ozlz_explorer_api_key';

interface RpcOverrides {
  starknetMainnet: string;
  starknetSepolia: string;
  /** chainId -> RPC URL. Lets users plug in their own Alchemy/Infura/etc. for any EVM chain. */
  evmRpcs?: Record<number, string>;
}

function loadOverrides(): RpcOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RpcOverrides;
      return { starknetMainnet: parsed.starknetMainnet ?? '', starknetSepolia: parsed.starknetSepolia ?? '', evmRpcs: parsed.evmRpcs ?? {} };
    }
  } catch { /* ignore */ }
  return { starknetMainnet: '', starknetSepolia: '', evmRpcs: {} };
}

function saveOverrides(overrides: RpcOverrides): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

/** Resolver used outside React (e.g. inside useLZChains.fetchChains). */
export function getEvmRpc(chainId: number, defaultRpc: string): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultRpc;
    const parsed = JSON.parse(raw) as RpcOverrides;
    const url = parsed.evmRpcs?.[chainId]?.trim();
    return url || defaultRpc;
  } catch {
    return defaultRpc;
  }
}

function loadApiKey(): string {
  try { return localStorage.getItem(API_KEY_STORAGE) ?? ''; } catch { return ''; }
}

function saveApiKey(key: string): void {
  if (key.trim()) localStorage.setItem(API_KEY_STORAGE, key.trim());
  else localStorage.removeItem(API_KEY_STORAGE);
}

export function getStarknetMainnetRpc(defaultRpc: string): string {
  const o = loadOverrides();
  return o.starknetMainnet.trim() || defaultRpc;
}

export function getStarknetSepoliaRpc(defaultRpc: string): string {
  const o = loadOverrides();
  return o.starknetSepolia.trim() || defaultRpc;
}

function SettingRow({ label, hint, value, onChange, placeholder }: {
  label: string; hint: string;
  value: string; onChange: (v: string) => void; placeholder: string;
}): JSX.Element {
  return (
    <div className="mb-5">
      <div className="label">{label}</div>
      <p className="text-xs text-on-surface-variant mb-2">{hint}</p>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}

export function Settings(): JSX.Element {
  const [overrides, setOverrides] = useState<RpcOverrides>(loadOverrides);
  const [saved, setSaved] = useState(false);
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [evmRpcsText, setEvmRpcsText] = useState(() => JSON.stringify(loadOverrides().evmRpcs ?? {}, null, 2));
  const [evmRpcsError, setEvmRpcsError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  useEffect(() => {
    if (!apiKeySaved) return;
    const t = setTimeout(() => setApiKeySaved(false), 2000);
    return () => clearTimeout(t);
  }, [apiKeySaved]);

  function update(key: keyof RpcOverrides, value: string): void {
    setOverrides((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleSave(): void {
    saveOverrides(overrides);
    setSaved(true);
  }

  function handleReset(): void {
    const empty: RpcOverrides = { starknetMainnet: '', starknetSepolia: '', evmRpcs: {} };
    setOverrides(empty);
    setEvmRpcsText('{}');
    setEvmRpcsError(null);
    saveOverrides(empty);
    setSaved(false);
  }

  function handleSaveEvmRpcs(): void {
    try {
      const parsed = JSON.parse(evmRpcsText) as Record<string, string>;
      // Coerce keys to numbers and validate URLs.
      const normalized: Record<number, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const id = Number(k);
        if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid chainId: ${k}`);
        if (typeof v !== 'string' || !v.startsWith('http')) throw new Error(`Invalid RPC URL for chainId ${k}`);
        normalized[id] = v.trim();
      }
      const next = { ...overrides, evmRpcs: normalized };
      setOverrides(next);
      saveOverrides(next);
      setEvmRpcsError(null);
      setSaved(true);
    } catch (e) {
      setEvmRpcsError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleSaveApiKey(): void {
    saveApiKey(apiKey);
    setApiKeySaved(true);
  }

  return (
    <div className="max-w-2xl space-y-6">

      <Section icon="key" title="Explorer API Key" subtitle="Used by Timelock scan to fetch on-chain events. Works across all supported chains (Etherscan V2 API).">
        <SettingRow
          label="Etherscan API Key"
          hint="Get a free key from etherscan.io/apis. The V2 API works for all EVM chains (Arbitrum, Base, Optimism, etc)."
          value={apiKey}
          onChange={setApiKey}
          placeholder="Your Etherscan API key"
        />
        <div className="flex gap-3 items-center mt-2">
          <button className="btn btn-primary" onClick={handleSaveApiKey}><span className="material-symbols-outlined text-sm">save</span> Save</button>
          <button className="btn" onClick={() => { setApiKey(''); saveApiKey(''); }}><span className="material-symbols-outlined text-sm">delete</span> Clear</button>
          {apiKeySaved && <span className="text-xs text-secondary">Saved</span>}
        </div>
      </Section>

      <Section icon="bolt" title="EVM RPC Overrides" subtitle="Plug in your own RPC per chain (Alchemy, Infura, drpc, …) to bypass public-RPC rate limits.">
        <p className="text-xs text-on-surface-variant mb-2">
          JSON map of <code className="font-mono text-on-surface">chainId → URL</code>. Example:
        </p>
        <pre className="text-[11px] font-mono text-on-surface-variant bg-surface-container rounded p-2 mb-3 overflow-x-auto">{`{\n  "1": "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",\n  "8453": "https://base-mainnet.g.alchemy.com/v2/YOUR_KEY",\n  "42161": "https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY",\n  "421614": "https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY"\n}`}</pre>
        <textarea
          className="input font-mono text-xs"
          rows={8}
          value={evmRpcsText}
          onChange={(e) => { setEvmRpcsText(e.target.value); setEvmRpcsError(null); }}
          spellCheck={false}
        />
        {evmRpcsError && <div className="text-xs text-error mt-1">{evmRpcsError}</div>}
        <div className="flex gap-3 items-center mt-2">
          <button className="btn btn-primary" onClick={handleSaveEvmRpcs}><span className="material-symbols-outlined text-sm">save</span> Save EVM RPCs</button>
          <span className="text-xs text-on-surface-variant">Reload after saving to apply.</span>
        </div>
      </Section>

      <Section icon="dns" title="Starknet RPC Endpoints" subtitle="Override default public RPC endpoints. Leave blank for defaults.">
        <SettingRow
          label="Starknet Mainnet"
          hint="Default: https://rpc.starknet.lava.build (fallback: https://starknet.drpc.org)"
          value={overrides.starknetMainnet}
          onChange={(v) => update('starknetMainnet', v)}
          placeholder="https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY"
        />
        <SettingRow
          label="Starknet Sepolia"
          hint="Default: https://starknet-sepolia.drpc.org"
          value={overrides.starknetSepolia}
          onChange={(v) => update('starknetSepolia', v)}
          placeholder="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY"
        />
        <div className="flex gap-3 items-center mt-2">
          <button className="btn btn-primary" onClick={handleSave}><span className="material-symbols-outlined text-sm">save</span> Save</button>
          <button className="btn" onClick={handleReset}><span className="material-symbols-outlined text-sm">restart_alt</span> Reset</button>
          {saved && <span className="text-xs text-secondary">Saved — reload to apply</span>}
        </div>
      </Section>

      <Section icon="info" title="Current Configuration" subtitle="Active runtime settings">
        <div className="text-xs font-mono space-y-1.5 text-on-surface-variant">
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Version</span><span className="text-on-surface">v{packageJson.version}</span></div>
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Explorer API key</span><span className="text-on-surface">{apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : 'Not set (using env default)'}</span></div>
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Starknet mainnet</span><span className="text-on-surface break-all">{overrides.starknetMainnet || 'https://rpc.starknet.lava.build (default)'}</span></div>
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Starknet sepolia</span><span className="text-on-surface break-all">{overrides.starknetSepolia || 'https://starknet-sepolia.drpc.org (default)'}</span></div>
        </div>
      </Section>

    </div>
  );
}
