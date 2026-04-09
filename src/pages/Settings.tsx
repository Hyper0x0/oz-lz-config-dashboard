import { useState, useEffect } from 'react';
import packageJson from '../../package.json';
import { Section } from '@/components/Section';

const STORAGE_KEY = 'ozlz_rpc_overrides';
const API_KEY_STORAGE = 'ozlz_explorer_api_key';

interface RpcOverrides {
  starknetMainnet: string;
  starknetSepolia: string;
}

function loadOverrides(): RpcOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as RpcOverrides;
  } catch { /* ignore */ }
  return { starknetMainnet: '', starknetSepolia: '' };
}

function saveOverrides(overrides: RpcOverrides): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
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
    const empty = { starknetMainnet: '', starknetSepolia: '' };
    setOverrides(empty);
    saveOverrides(empty);
    setSaved(false);
  }

  function handleSaveApiKey(): void {
    saveApiKey(apiKey);
    setApiKeySaved(true);
  }

  return (
    <div className="max-w-2xl space-y-6">

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
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
          <button className="btn" onClick={handleReset}>Reset to defaults</button>
          {saved && <span className="text-xs text-secondary">Saved — reload to apply</span>}
        </div>
      </Section>

      <Section icon="key" title="Explorer API Key" subtitle="Used by Timelock scan to fetch on-chain events. Works across all supported chains (Etherscan V2 API).">
        <SettingRow
          label="Etherscan API Key"
          hint="Get a free key from etherscan.io/apis. The V2 API works for all EVM chains (Arbitrum, Base, Optimism, etc)."
          value={apiKey}
          onChange={setApiKey}
          placeholder="Your Etherscan API key"
        />
        <div className="flex gap-3 items-center mt-2">
          <button className="btn btn-primary" onClick={handleSaveApiKey}>Save</button>
          <button className="btn" onClick={() => { setApiKey(''); saveApiKey(''); }}>Clear</button>
          {apiKeySaved && <span className="text-xs text-secondary">Saved</span>}
        </div>
      </Section>

      <Section icon="info" title="Current Configuration" subtitle="Active runtime settings">
        <div className="text-xs font-mono space-y-1.5 text-on-surface-variant">
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Version</span><span className="text-on-surface">v{packageJson.version}</span></div>
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Starknet mainnet</span><span className="text-on-surface break-all">{overrides.starknetMainnet || 'https://rpc.starknet.lava.build (default)'}</span></div>
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Starknet sepolia</span><span className="text-on-surface break-all">{overrides.starknetSepolia || 'https://starknet-sepolia.drpc.org (default)'}</span></div>
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Explorer API key</span><span className="text-on-surface">{apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : 'Not set (using env default)'}</span></div>
        </div>
      </Section>

    </div>
  );
}
