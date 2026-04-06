import { useState, useEffect } from 'react';
import packageJson from '../../package.json';
import { Section } from '@/components/Section';

const STORAGE_KEY = 'ozlz_rpc_overrides';

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

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

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

      <Section icon="info" title="Current Configuration" subtitle="Active runtime settings">
        <div className="text-xs font-mono space-y-1.5 text-on-surface-variant">
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Version</span><span className="text-on-surface">v{packageJson.version}</span></div>
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Starknet mainnet</span><span className="text-on-surface break-all">{overrides.starknetMainnet || 'https://rpc.starknet.lava.build (default)'}</span></div>
          <div className="flex gap-2"><span className="label w-40 flex-shrink-0 mb-0">Starknet sepolia</span><span className="text-on-surface break-all">{overrides.starknetSepolia || 'https://starknet-sepolia.drpc.org (default)'}</span></div>
        </div>
      </Section>

    </div>
  );
}
