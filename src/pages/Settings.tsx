import { useState, useEffect, useMemo } from 'react';
import packageJson from '../../package.json';
import { Section } from '@/components/Section';
import { Spinner } from '@/components/Spinner';
import { useLZChains } from '@/hooks/useLZChains';
import { useToast } from '@/context/ToastContext';

const STORAGE_KEY = 'ozlz_rpc_overrides';
const API_KEY_STORAGE = 'ozlz_explorer_api_key';

const STARKNET_MAINNET_DEFAULT = 'https://rpc.starknet.lava.build';
const STARKNET_SEPOLIA_DEFAULT = 'https://free-rpc.nethermind.io/sepolia-juno/v0_7';

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
  /** Starknet only — JSON-RPC spec version reported by the node (e.g. "0.7.1"). */
  specVersion?: string;
  /** Set when the node speaks a JSON-RPC spec incompatible with starknet.js@6.x (which expects 0.7.x). */
  specWarning?: string;
}

/** starknet.js@6.x speaks Starknet JSON-RPC 0.7.x — flag any other major.minor. */
const STARKNET_EXPECTED_SPEC = '0.7';

async function jsonRpcCall(url: string, method: string, signal: AbortSignal): Promise<{ result?: string; error?: { message?: string }; httpStatus: number; rawText: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params: [], id: 1 }),
    signal,
  });
  const rawText = await res.text();
  try {
    const json = JSON.parse(rawText) as { result?: string; error?: { message?: string } };
    return { ...json, httpStatus: res.status, rawText };
  } catch {
    return { httpStatus: res.status, rawText };
  }
}

async function probeJsonRpc(url: string, method: string): Promise<TestResult> {
  const start = performance.now();
  const elapsed = (): number => Math.round(performance.now() - start);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const reply = await jsonRpcCall(url, method, ctrl.signal);
    clearTimeout(timer);

    if (reply.httpStatus === 429) {
      return { state: 'fail', latencyMs: elapsed(), error: 'Rate-limited (HTTP 429). Use a private RPC.' };
    }
    if (!reply.rawText) {
      return { state: 'fail', latencyMs: elapsed(), error: `HTTP ${reply.httpStatus}: empty response` };
    }
    if (reply.result === undefined && reply.error === undefined) {
      const snippet = reply.rawText.trim().slice(0, 80);
      return {
        state: 'fail',
        latencyMs: elapsed(),
        error: reply.httpStatus < 400 ? `Non-JSON response: ${snippet}` : `HTTP ${reply.httpStatus}: ${snippet}`,
      };
    }
    if (reply.httpStatus >= 400) {
      return { state: 'fail', latencyMs: elapsed(), error: `HTTP ${reply.httpStatus}: ${reply.error?.message ?? 'request failed'}` };
    }
    if (reply.error) {
      return { state: 'fail', latencyMs: elapsed(), error: reply.error.message ?? 'RPC error' };
    }

    const base: TestResult = { state: 'ok', latencyMs: elapsed(), chainIdHex: reply.result };

    // Starknet: also probe spec version so we can warn about v0.5/v0.10 endpoints
    // that look healthy but will fail mid-call in starknet.js@6.x.
    if (method === 'starknet_chainId') {
      try {
        const specCtrl = new AbortController();
        const specTimer = setTimeout(() => specCtrl.abort(), 4000);
        const spec = await jsonRpcCall(url, 'starknet_specVersion', specCtrl.signal);
        clearTimeout(specTimer);
        if (typeof spec.result === 'string') {
          base.specVersion = spec.result;
          if (!spec.result.startsWith(`${STARKNET_EXPECTED_SPEC}.`)) {
            base.specWarning = `RPC spec ${spec.result} — starknet.js@6.x expects ${STARKNET_EXPECTED_SPEC}.x. Reads/writes will fail. Use a /rpc/v0_7 endpoint.`;
          }
        }
      } catch { /* spec probe is advisory only */ }
    }

    return base;
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { state: 'fail', latencyMs: elapsed(), error: 'Timed out after 8s' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { state: 'fail', latencyMs: elapsed(), error: msg };
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
            ? <Spinner size="sm" />
            : <><span className="material-symbols-outlined text-sm">network_check</span> Test</>
          }
        </button>
      </div>
      {error && <div className="text-xs text-error mt-1">{error}</div>}
      {test && test.state !== 'testing' && (
        <div className="mt-1 space-y-1">
          <div className={`text-xs flex items-center gap-1.5 ${test.state === 'ok' ? (test.specWarning ? 'text-warn' : 'text-secondary') : 'text-error'}`}>
            <span className="material-symbols-outlined text-sm">
              {test.state === 'ok' ? (test.specWarning ? 'warning' : 'check_circle') : 'error'}
            </span>
            {test.state === 'ok'
              ? `OK · ${test.latencyMs}ms${test.chainIdHex ? ` · chainId ${formatChainId(test.chainIdHex, !!test.specVersion)}` : ''}${test.specVersion ? ` · spec ${test.specVersion}` : ''}`
              : `Failed · ${test.error ?? 'unknown error'}`}
          </div>
          {test.specWarning && (
            <div className="text-xs text-warn pl-5 leading-relaxed">{test.specWarning}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Starknet chainIds are ASCII-encoded shortstrings (e.g. 0x534e5f5345504f4c4941 = "SN_SEPOLIA"); decode them. EVM stays decimal. */
function formatChainId(hex: string, isStarknet: boolean): string {
  if (!isStarknet) return String(parseInt(hex, 16));
  try {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0 || clean.length > 64) return hex;
    let ascii = '';
    for (let i = 0; i < clean.length; i += 2) {
      const code = parseInt(clean.slice(i, i + 2), 16);
      if (code < 32 || code > 126) return hex; // not printable → fall back to hex
      ascii += String.fromCharCode(code);
    }
    return ascii || hex;
  } catch {
    return hex;
  }
}

export function Settings(): JSX.Element {
  const [overrides, setOverrides] = useState<RpcOverrides>(loadOverrides);
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(apiKey);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const toast = useToast();

  // Load all chains (mainnet + testnet) for the EVM RPC chain dropdown.
  const { allChains, loading: chainsLoading } = useLZChains(false);

  function flash(msg: string): void {
    toast.success(msg);
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
    if (result.state === 'fail') {
      toast.error('RPC test failed', result.error ?? 'unknown error');
    } else if (result.specWarning) {
      toast.warn('RPC spec mismatch', result.specWarning);
    }
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
        <button className="btn btn-sm btn-danger" onClick={handleResetAll} title="Reset all overrides">
          <span className="material-symbols-outlined text-sm">restart_alt</span> Reset all
        </button>
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
                <div key={row.chainId} className="subpanel rounded-lg p-3">
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
                        ? <Spinner size="sm" />
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
                    <div className={`text-xs flex items-center gap-1.5 flex-wrap ${tests[testKey].state === 'ok' ? 'text-secondary' : 'text-error'}`}>
                      <span className="material-symbols-outlined text-sm">{tests[testKey].state === 'ok' ? 'check_circle' : 'error'}</span>
                      {tests[testKey].state === 'ok'
                        ? `OK · ${tests[testKey].latencyMs}ms${tests[testKey].chainIdHex ? ` · chainId ${parseInt(tests[testKey].chainIdHex!, 16)}` : ''}`
                        : `Failed · ${tests[testKey].error ?? 'unknown error'}`}
                      {tests[testKey].state === 'ok' && tests[testKey].chainIdHex && parseInt(tests[testKey].chainIdHex!, 16) !== row.chainId && (
                        <span className="text-warn">· chainId mismatch (expected {row.chainId})</span>
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
