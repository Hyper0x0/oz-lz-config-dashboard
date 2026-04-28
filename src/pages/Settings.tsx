import { useState, useEffect, useMemo } from 'react';
import packageJson from '../../package.json';
import { Section } from '@/components/Section';
import { useLZChains } from '@/hooks/useLZChains';

const STORAGE_KEY = 'ozlz_rpc_overrides';
const API_KEY_STORAGE = 'ozlz_explorer_api_key';

const STARKNET_MAINNET_DEFAULT = 'https://rpc.starknet.lava.build';
const STARKNET_SEPOLIA_DEFAULT = 'https://starknet-sepolia.drpc.org';

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

function dispatchRpcChanged(): void {
  window.dispatchEvent(new Event('ozlz:rpc-changed'));
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

interface TestResult {
  state: 'idle' | 'testing' | 'ok' | 'fail';
  latencyMs?: number;
  error?: string;
  chainIdHex?: string;
}

async function probeJsonRpc(url: string, method: string): Promise<TestResult> {
  const start = performance.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params: [], id: 1 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const json = await res.json() as { result?: string; error?: { message?: string } };
    if (json.error) return { state: 'fail', latencyMs: Math.round(performance.now() - start), error: json.error.message ?? 'RPC error' };
    return { state: 'ok', latencyMs: Math.round(performance.now() - start), chainIdHex: json.result };
  } catch (e) {
    return { state: 'fail', latencyMs: Math.round(performance.now() - start), error: e instanceof Error ? e.message : String(e) };
  }
}

function isLikelyUrl(s: string): boolean {
  return /^https?:\/\/.+/i.test(s.trim()) || /^wss?:\/\/.+/i.test(s.trim());
}

interface UrlFieldProps {
  label: string;
  hint?: string;
  defaultUrl?: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  test?: TestResult;
  onTest: () => void;
  rightAdornment?: React.ReactNode;
}

function UrlField({ label, hint, defaultUrl, value, onCommit, placeholder, test, onTest, rightAdornment }: UrlFieldProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(value); }, [value]);

  function commit(): void {
    const next = draft.trim();
    if (next && !isLikelyUrl(next)) {
      setError('Must start with http(s):// or ws(s)://');
      return;
    }
    setError(null);
    if (next === value) return;
    onCommit(next);
  }

  const isCustom = value.trim().length > 0;
  const active = value.trim() || defaultUrl || '';

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="label mb-0">{label}</span>
          <span
            className={`text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded ${
              isCustom ? 'text-primary bg-primary/10' : 'text-on-surface-variant bg-surface-container'
            }`}
          >
            {isCustom ? 'custom' : 'default'}
          </span>
        </div>
        {rightAdornment}
      </div>
      {hint && <p className="text-xs text-on-surface-variant mb-1.5">{hint}</p>}
      <div className="flex gap-2">
        <input
          className="input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="btn btn-sm flex-shrink-0"
          onClick={onTest}
          disabled={test?.state === 'testing' || !active}
          title={active ? `Test ${active}` : 'No URL to test'}
        >
          {test?.state === 'testing'
            ? <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span></>
            : <><span className="material-symbols-outlined text-sm">network_check</span> Test</>
          }
        </button>
      </div>
      {error && <div className="text-xs text-error mt-1">{error}</div>}
      {test && test.state !== 'testing' && (
        <div className={`text-xs mt-1 flex items-center gap-1.5 ${test.state === 'ok' ? 'text-secondary' : 'text-error'}`}>
          <span className="material-symbols-outlined text-sm">{test.state === 'ok' ? 'check_circle' : 'error'}</span>
          {test.state === 'ok'
            ? `OK · ${test.latencyMs}ms${test.chainIdHex ? ` · chainId ${parseInt(test.chainIdHex, 16)}` : ''}`
            : `Failed · ${test.error ?? 'unknown error'}`}
        </div>
      )}
    </div>
  );
}

export function Settings(): JSX.Element {
  const [overrides, setOverrides] = useState<RpcOverrides>(loadOverrides);
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(apiKey);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  // Load all chains (mainnet + testnet) for the EVM RPC chain dropdown.
  const { allChains, loading: chainsLoading } = useLZChains(false);

  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(null), 1800);
    return () => clearTimeout(t);
  }, [savedFlash]);

  function flash(msg: string): void {
    setSavedFlash(msg);
  }

  function persistOverrides(next: RpcOverrides): void {
    setOverrides(next);
    saveOverrides(next);
    dispatchRpcChanged();
    flash('Saved');
  }

  function commitStarknetMainnet(url: string): void {
    persistOverrides({ ...overrides, starknetMainnet: url });
  }

  function commitStarknetSepolia(url: string): void {
    persistOverrides({ ...overrides, starknetSepolia: url });
  }

  function commitEvmUrl(chainId: number, url: string): void {
    persistOverrides({ ...overrides, evmRpcs: { ...(overrides.evmRpcs ?? {}), [chainId]: url } });
  }

  function changeEvmChain(oldId: number, newId: number): void {
    if (oldId === newId) return;
    const map = { ...(overrides.evmRpcs ?? {}) };
    const url = map[oldId] ?? '';
    delete map[oldId];
    map[newId] = url;
    persistOverrides({ ...overrides, evmRpcs: map });
  }

  function removeEvmRow(chainId: number): void {
    const map = { ...(overrides.evmRpcs ?? {}) };
    delete map[chainId];
    persistOverrides({ ...overrides, evmRpcs: map });
  }

  function addEvmRow(): void {
    const used = new Set(Object.keys(overrides.evmRpcs ?? {}).map(Number));
    const pick = allChains.find((c) => !used.has(c.chainId));
    if (!pick) return;
    persistOverrides({ ...overrides, evmRpcs: { ...(overrides.evmRpcs ?? {}), [pick.chainId]: '' } });
  }

  function commitApiKey(): void {
    const next = apiKeyDraft.trim();
    if (next === apiKey) return;
    setApiKey(next);
    saveApiKey(next);
    flash('Saved');
  }

  function clearApiKey(): void {
    setApiKey('');
    setApiKeyDraft('');
    saveApiKey('');
    flash('Cleared');
  }

  async function runTest(key: string, kind: 'evm' | 'starknet', url: string): Promise<void> {
    if (!url) return;
    setTests((t) => ({ ...t, [key]: { state: 'testing' } }));
    const result = await probeJsonRpc(url, kind === 'evm' ? 'eth_chainId' : 'starknet_chainId');
    setTests((t) => ({ ...t, [key]: result }));
  }

  function handleResetAll(): void {
    const ok = window.confirm('Reset all RPC overrides and clear the Etherscan key? This cannot be undone.');
    if (!ok) return;
    const empty: RpcOverrides = { starknetMainnet: '', starknetSepolia: '', evmRpcs: {} };
    setOverrides(empty);
    saveOverrides(empty);
    setApiKey('');
    setApiKeyDraft('');
    saveApiKey('');
    setTests({});
    dispatchRpcChanged();
    flash('Reset');
  }

  // EVM rows derived from overrides, sorted by chain id for stability.
  const evmRows = useMemo(() => {
    const entries = Object.entries(overrides.evmRpcs ?? {});
    return entries
      .map(([id, url]) => ({ chainId: Number(id), url: url ?? '' }))
      .sort((a, b) => a.chainId - b.chainId);
  }, [overrides.evmRpcs]);

  const usedChainIds = useMemo(() => new Set(evmRows.map((r) => r.chainId)), [evmRows]);
  const hasUnusedChain = allChains.some((c) => !usedChainIds.has(c.chainId));

  // For the Add Override button to be useful we need chain metadata loaded.
  const addDisabled = chainsLoading || !hasUnusedChain;

  return (
    <div className="max-w-2xl space-y-6">

      <div className="flex items-center justify-between">
        <h2 className="font-headline text-lg font-semibold text-on-surface m-0">Settings</h2>
        <div className="flex items-center gap-3">
          {savedFlash && (
            <span className="text-xs text-secondary flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              {savedFlash}
            </span>
          )}
          <button className="btn btn-sm btn-danger" onClick={handleResetAll} title="Reset all overrides">
            <span className="material-symbols-outlined text-sm">restart_alt</span> Reset all
          </button>
        </div>
      </div>

      <Section icon="key" title="Explorer API Key" subtitle="Used by Timelock scan to fetch on-chain events. Works across all supported EVM chains (Etherscan V2 API).">
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="label mb-0">Etherscan API Key</span>
            <span className={`text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded ${
              apiKey ? 'text-primary bg-primary/10' : 'text-on-surface-variant bg-surface-container'
            }`}>
              {apiKey ? 'set' : 'not set'}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant mb-1.5">
            Get a free key from etherscan.io/apis. The V2 API works for all EVM chains (Arbitrum, Base, Optimism, etc).
          </p>
          <div className="flex gap-2">
            <input
              className="input font-mono"
              type={showApiKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              onBlur={commitApiKey}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder="Your Etherscan API key"
            />
            <button
              type="button"
              className="btn btn-sm flex-shrink-0"
              onClick={() => setShowApiKey((v) => !v)}
              title={showApiKey ? 'Hide key' : 'Show key'}
            >
              <span className="material-symbols-outlined text-sm">{showApiKey ? 'visibility_off' : 'visibility'}</span>
            </button>
            {apiKey && (
              <button type="button" className="btn btn-sm btn-danger flex-shrink-0" onClick={clearApiKey} title="Remove key">
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            )}
          </div>
        </div>
      </Section>

      <Section
        icon="bolt"
        title="EVM RPC Overrides"
        subtitle="Plug in your own RPC per chain (Alchemy, Infura, drpc, …) to bypass public-RPC rate limits."
        actions={
          <button className="btn btn-sm" onClick={addEvmRow} disabled={addDisabled}>
            <span className="material-symbols-outlined text-sm">add</span> Add override
          </button>
        }
      >
        {evmRows.length === 0 ? (
          <p className="text-xs text-on-surface-variant py-2">No overrides yet. Click <em>Add override</em> to set a custom RPC for a chain.</p>
        ) : (
          <div className="space-y-3">
            {evmRows.map((row) => {
              const chain = allChains.find((c) => c.chainId === row.chainId);
              const testKey = `evm:${row.chainId}`;
              return (
                <div key={row.chainId} className="bg-surface-container/50 border border-outline-variant/20 rounded-lg p-3">
                  <div className="flex gap-2 items-start mb-2">
                    <select
                      className="input flex-shrink-0"
                      style={{ width: '220px' }}
                      value={row.chainId}
                      onChange={(e) => changeEvmChain(row.chainId, Number(e.target.value))}
                    >
                      {!chain && <option value={row.chainId}>Unknown chain ({row.chainId})</option>}
                      {allChains
                        .filter((c) => c.chainId === row.chainId || !usedChainIds.has(c.chainId))
                        .map((c) => (
                          <option key={c.chainId} value={c.chainId}>
                            {c.name} {c.isTestnet ? '(testnet)' : ''} · {c.chainId}
                          </option>
                        ))}
                    </select>
                    <input
                      className="input font-mono text-xs"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      defaultValue={row.url}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && !isLikelyUrl(next)) return;
                        if (next !== row.url) commitEvmUrl(row.chainId, next);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      placeholder="https://…"
                    />
                    <button
                      type="button"
                      className="btn btn-sm flex-shrink-0"
                      onClick={() => runTest(testKey, 'evm', row.url)}
                      disabled={tests[testKey]?.state === 'testing' || !row.url}
                      title={row.url ? `Test ${row.url}` : 'Enter a URL first'}
                    >
                      {tests[testKey]?.state === 'testing'
                        ? <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                        : <span className="material-symbols-outlined text-sm">network_check</span>}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger flex-shrink-0"
                      onClick={() => removeEvmRow(row.chainId)}
                      title="Remove override"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                  {tests[testKey] && tests[testKey].state !== 'testing' && (
                    <div className={`text-xs flex items-center gap-1.5 ${tests[testKey].state === 'ok' ? 'text-secondary' : 'text-error'}`}>
                      <span className="material-symbols-outlined text-sm">{tests[testKey].state === 'ok' ? 'check_circle' : 'error'}</span>
                      {tests[testKey].state === 'ok'
                        ? `OK · ${tests[testKey].latencyMs}ms${tests[testKey].chainIdHex ? ` · chainId ${parseInt(tests[testKey].chainIdHex!, 16)}` : ''}`
                        : `Failed · ${tests[testKey].error ?? 'unknown error'}`}
                      {tests[testKey].state === 'ok' && tests[testKey].chainIdHex && parseInt(tests[testKey].chainIdHex!, 16) !== row.chainId && (
                        <span className="ml-1" style={{ color: 'var(--warn)' }}>· chainId mismatch (expected {row.chainId})</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section icon="dns" title="Starknet RPC Endpoints" subtitle="Override default public RPC endpoints. Leave blank for defaults.">
        <UrlField
          label="Starknet Mainnet"
          hint={`Default: ${STARKNET_MAINNET_DEFAULT}`}
          defaultUrl={STARKNET_MAINNET_DEFAULT}
          value={overrides.starknetMainnet}
          onCommit={commitStarknetMainnet}
          placeholder="https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY"
          test={tests['starknet:mainnet']}
          onTest={() => runTest('starknet:mainnet', 'starknet', overrides.starknetMainnet.trim() || STARKNET_MAINNET_DEFAULT)}
        />
        <UrlField
          label="Starknet Sepolia"
          hint={`Default: ${STARKNET_SEPOLIA_DEFAULT}`}
          defaultUrl={STARKNET_SEPOLIA_DEFAULT}
          value={overrides.starknetSepolia}
          onCommit={commitStarknetSepolia}
          placeholder="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY"
          test={tests['starknet:sepolia']}
          onTest={() => runTest('starknet:sepolia', 'starknet', overrides.starknetSepolia.trim() || STARKNET_SEPOLIA_DEFAULT)}
        />
      </Section>

      <div className="text-xs text-on-surface-variant text-right pr-1">
        v{packageJson.version}
      </div>

    </div>
  );
}
