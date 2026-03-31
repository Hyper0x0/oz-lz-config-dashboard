import { useState, useEffect } from 'react';
import packageJson from '../../package.json';

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
      <label className="block font-headline text-sm font-semibold text-on-surface mb-0.5">{label}</label>
      <p className="text-xs text-on-surface-variant mb-2">{hint}</p>
      <input
        className="input w-full max-w-lg font-mono text-[12px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-6 mb-5">
      <h3 className="font-headline text-base font-bold text-on-surface mb-4">{title}</h3>
      {children}
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
    <div className="max-w-2xl">

      <SectionCard title="Starknet RPC Endpoints">
        <p className="text-xs text-on-surface-variant mb-4">
          Override the default public RPC endpoints. Leave blank to use the defaults.
          Changes take effect on next page load.
        </p>
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
      </SectionCard>

      <SectionCard title="Current Configuration">
        <div className="text-xs font-mono space-y-1.5 text-on-surface-variant">
          <div className="flex gap-2"><span className="text-outline-variant w-40 flex-shrink-0">Version</span><span className="text-on-surface">v{packageJson.version}</span></div>
          <div className="flex gap-2"><span className="text-outline-variant w-40 flex-shrink-0">Starknet mainnet</span><span className="text-on-surface break-all">{overrides.starknetMainnet || 'https://rpc.starknet.lava.build (default)'}</span></div>
          <div className="flex gap-2"><span className="text-outline-variant w-40 flex-shrink-0">Starknet sepolia</span><span className="text-on-surface break-all">{overrides.starknetSepolia || 'https://starknet-sepolia.drpc.org (default)'}</span></div>
        </div>
      </SectionCard>

    </div>
  );
}
