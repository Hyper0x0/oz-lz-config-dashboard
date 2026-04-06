import { useState, useCallback, useEffect } from 'react';
import { Contract, JsonRpcProvider, Interface, keccak256, toUtf8Bytes } from 'ethers';
import { useWallet } from '@/context/WalletContext';
import { TxStatus } from '@/components/TxStatus';
import { Section } from '@/components/Section';
import { PageLayout } from '@/components/PageLayout';
import { ChainBadge } from '@/components/ChainBadge';
import AccessControlABI from '@/abis/evm/AccessControl.json';
import { ARBISCAN_API_KEY } from '@/config/chains';
import type { TxState } from '@/types';

// ── Known role presets ──────────────────────────────────────────────────────

interface RolePreset { label: string; hash: string }

const BUILTIN_PRESETS: Record<string, RolePreset[]> = {
  'TimelockController': [
    { label: 'DEFAULT_ADMIN_ROLE',  hash: '0x0000000000000000000000000000000000000000000000000000000000000000' },
    { label: 'PROPOSER_ROLE',       hash: keccak256(toUtf8Bytes('PROPOSER_ROLE')) },
    { label: 'EXECUTOR_ROLE',       hash: keccak256(toUtf8Bytes('EXECUTOR_ROLE')) },
    { label: 'CANCELLER_ROLE',      hash: keccak256(toUtf8Bytes('CANCELLER_ROLE')) },
  ],
  'OFT / OApp': [
    { label: 'DEFAULT_ADMIN_ROLE',  hash: '0x0000000000000000000000000000000000000000000000000000000000000000' },
    { label: 'MINTER_ROLE',         hash: keccak256(toUtf8Bytes('MINTER_ROLE')) },
    { label: 'PAUSER_ROLE',         hash: keccak256(toUtf8Bytes('PAUSER_ROLE')) },
    { label: 'UPGRADER_ROLE',       hash: keccak256(toUtf8Bytes('UPGRADER_ROLE')) },
  ],
  'Common': [
    { label: 'DEFAULT_ADMIN_ROLE',  hash: '0x0000000000000000000000000000000000000000000000000000000000000000' },
    { label: 'MINTER_ROLE',         hash: keccak256(toUtf8Bytes('MINTER_ROLE')) },
    { label: 'BURNER_ROLE',         hash: keccak256(toUtf8Bytes('BURNER_ROLE')) },
    { label: 'PAUSER_ROLE',         hash: keccak256(toUtf8Bytes('PAUSER_ROLE')) },
    { label: 'UPGRADER_ROLE',       hash: keccak256(toUtf8Bytes('UPGRADER_ROLE')) },
  ],
};

// ── Custom roles persistence ────────────────────────────────────────────────

const CUSTOM_ROLES_KEY = 'ozlz_custom_roles';

function loadCustomRoles(): RolePreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ROLES_KEY);
    if (raw) return JSON.parse(raw) as RolePreset[];
  } catch { /* ignore */ }
  return [];
}

function saveCustomRoles(roles: RolePreset[]): void {
  localStorage.setItem(CUSTOM_ROLES_KEY, JSON.stringify(roles));
}

function computeHash(name: string): string {
  if (name.startsWith('0x') && name.length === 66) return name;
  return keccak256(toUtf8Bytes(name));
}

// ── Chain list (for explorer links + fallback RPC) ──────────────────────────

const CHAINS = [
  { id: 1,        name: 'Ethereum',        rpc: 'https://eth.llamarpc.com',                    explorer: 'etherscan.io' },
  { id: 42161,    name: 'Arbitrum',         rpc: 'https://arb1.arbitrum.io/rpc',                explorer: 'arbiscan.io' },
  { id: 421614,   name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc',      explorer: 'sepolia.arbiscan.io' },
  { id: 10,       name: 'Optimism',         rpc: 'https://mainnet.optimism.io',                 explorer: 'optimistic.etherscan.io' },
  { id: 8453,     name: 'Base',             rpc: 'https://mainnet.base.org',                    explorer: 'basescan.org' },
  { id: 84532,    name: 'Base Sepolia',     rpc: 'https://sepolia.base.org',                    explorer: 'sepolia.basescan.org' },
  { id: 137,      name: 'Polygon',          rpc: 'https://polygon-rpc.com',                     explorer: 'polygonscan.com' },
  { id: 56,       name: 'BNB Chain',        rpc: 'https://bsc-dataseed.binance.org',            explorer: 'bscscan.com' },
  { id: 43114,    name: 'Avalanche',        rpc: 'https://api.avax.network/ext/bc/C/rpc',       explorer: 'snowscan.xyz' },
  { id: 11155111, name: 'Sepolia',          rpc: 'https://rpc.sepolia.org',                     explorer: 'sepolia.etherscan.io' },
];

// ── Types ───────────────────────────────────────────────────────────────────

interface RoleHolder { role: string; roleLabel: string; account: string }

// ── Component ───────────────────────────────────────────────────────────────

export function Roles(): JSX.Element {
  const { evm } = useWallet();

  // Chain: auto-detect from wallet, with manual override
  const walletChain = CHAINS.find((c) => c.id === evm.chainId);
  const [manualChainId, setManualChainId] = useState<number | null>(null);
  const activeChainId = manualChainId ?? evm.chainId ?? 421614;
  const chain = CHAINS.find((c) => c.id === activeChainId) ?? CHAINS[2];

  // Sync manual override when wallet changes
  useEffect(() => {
    if (evm.chainId && !manualChainId) { /* auto-follow wallet */ }
  }, [evm.chainId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [contractAddr, setContractAddr] = useState('');
  const [presetKey, setPresetKey] = useState<string>('TimelockController');
  const [customRoles, setCustomRoles] = useState<RolePreset[]>(loadCustomRoles);
  const [newRoleName, setNewRoleName] = useState('');

  // State
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acSupport, setAcSupport] = useState<'yes' | 'no' | 'unknown'>('unknown');

  // Role holders
  const [holders, setHolders] = useState<RoleHolder[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Wallet's roles
  const [myRoles, setMyRoles] = useState<Map<string, boolean>>(new Map());

  // Grant / Revoke / Renounce
  const [grantRoleHash, setGrantRoleHash] = useState('');
  const [grantAddr, setGrantAddr] = useState('');
  const [grantTx, setGrantTx] = useState<TxState>({ status: 'idle' });
  const [renounceTx, setRenounceTx] = useState<TxState>({ status: 'idle' });
  const [revokeMode, setRevokeMode] = useState(false);


  const builtinRoles = BUILTIN_PRESETS[presetKey] ?? [];
  const presetRoles = [...builtinRoles, ...customRoles];

  function addCustomRole(): void {
    if (!newRoleName.trim()) return;
    const hash = computeHash(newRoleName.trim());
    if (customRoles.some((r) => r.hash === hash)) return; // duplicate
    const updated = [...customRoles, { label: newRoleName.trim(), hash }];
    setCustomRoles(updated);
    saveCustomRoles(updated);
    setNewRoleName('');
  }

  function removeCustomRole(hash: string): void {
    const updated = customRoles.filter((r) => r.hash !== hash);
    setCustomRoles(updated);
    saveCustomRoles(updated);
  }

  const getProvider = useCallback(() => {
    // Use wallet provider if on the same chain, else public RPC
    if (evm.provider && evm.chainId === activeChainId) return evm.provider;
    return new JsonRpcProvider(chain.rpc);
  }, [evm.provider, evm.chainId, activeChainId, chain.rpc]);

  // ── Check contract + wallet roles ─────────────────────────────────────
  async function handleCheck(): Promise<void> {
    if (!contractAddr) return;
    setChecking(true);
    setError(null);
    setChecked(false);
    setAcSupport('unknown');
    setHolders([]);
    setMyRoles(new Map());
    try {
      const provider = getProvider();
      const c = new Contract(contractAddr, AccessControlABI, provider);

      // Soft ERC-165 check — many contracts don't implement it
      let supports: 'yes' | 'no' | 'unknown' = 'unknown';
      try {
        const result = await c.supportsInterface('0x7965db0b');
        supports = result ? 'yes' : 'no';
      } catch {
        supports = 'unknown'; // ERC-165 not implemented — continue anyway
      }
      setAcSupport(supports);

      if (supports === 'no') {
        setError('Contract explicitly returned false for IAccessControl interface');
        setChecking(false);
        return;
      }

      // Try hasRole for each preset — if ANY works, the contract has AccessControl
      if (evm.address) {
        const roleMap = new Map<string, boolean>();
        let anyWorked = false;
        for (const role of presetRoles) {
          try {
            const has = await c.hasRole(role.hash, evm.address);
            roleMap.set(role.hash, has);
            anyWorked = true;
          } catch {
            roleMap.set(role.hash, false);
          }
        }
        setMyRoles(roleMap);
        if (!anyWorked && supports === 'unknown') {
          setError('Contract does not appear to implement AccessControl — hasRole calls failed');
          setChecking(false);
          return;
        }
      }
      setChecked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  // ── Scan events ───────────────────────────────────────────────────────
  async function handleScan(): Promise<void> {
    if (!contractAddr) return;
    setScanning(true);
    setScanError(null);
    try {
      const iface = new Interface(AccessControlABI);
      const grantedTopic = iface.getEvent('RoleGranted')!.topicHash;
      const revokedTopic = iface.getEvent('RoleRevoked')!.topicHash;
      const base = `https://api.etherscan.io/v2/api?chainid=${chain.id}&module=logs&action=getLogs&address=${contractAddr}&fromBlock=0&toBlock=latest&apikey=${ARBISCAN_API_KEY}`;

      type LogEntry = { topics: string[]; data: string };
      async function fetchLogs(topic0: string): Promise<LogEntry[]> {
        const res = await fetch(`${base}&topic0=${topic0}`);
        const json = await res.json() as { status: string; result: unknown; message?: string };
        if (!Array.isArray(json.result)) {
          const detail = typeof json.result === 'string' ? json.result : (json.message ?? 'unknown');
          if (detail === 'No records found') return [];
          throw new Error(`Explorer API: ${detail}`);
        }
        return json.result as LogEntry[];
      }

      const grantedLogs = await fetchLogs(grantedTopic);
      await new Promise((r) => setTimeout(r, 300));
      const revokedLogs = await fetchLogs(revokedTopic);

      const roleAccounts = new Map<string, Set<string>>();
      for (const log of grantedLogs) {
        const role = log.topics[1];
        const account = '0x' + log.topics[2].slice(26);
        if (!roleAccounts.has(role)) roleAccounts.set(role, new Set());
        roleAccounts.get(role)!.add(account.toLowerCase());
      }
      for (const log of revokedLogs) {
        const role = log.topics[1];
        const account = '0x' + log.topics[2].slice(26);
        roleAccounts.get(role)?.delete(account.toLowerCase());
      }

      const result: RoleHolder[] = [];
      for (const [roleHash, accounts] of roleAccounts) {
        const preset = presetRoles.find((p) => p.hash.toLowerCase() === roleHash.toLowerCase());
        const label = preset?.label ?? `0x${roleHash.slice(2, 10)}…`;
        for (const account of accounts) {
          result.push({ role: roleHash, roleLabel: label, account });
        }
      }
      result.sort((a, b) => a.roleLabel.localeCompare(b.roleLabel) || a.account.localeCompare(b.account));
      setHolders(result);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  // ── Grant or Revoke ───────────────────────────────────────────────────
  async function handleGrantRevoke(): Promise<void> {
    if (!contractAddr || !grantRoleHash || !grantAddr || !evm.signer) return;
    setGrantTx({ status: 'pending' });
    try {
      const c = new Contract(contractAddr, AccessControlABI, evm.signer);
      const tx = revokeMode
        ? await c.revokeRole(grantRoleHash, grantAddr)
        : await c.grantRole(grantRoleHash, grantAddr);
      await tx.wait();
      setGrantTx({ status: 'success', hash: tx.hash });
      void handleCheck();
      void handleScan();
    } catch (e) {
      setGrantTx({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleRenounce(roleHash: string): Promise<void> {
    if (!contractAddr || !evm.signer || !evm.address) return;
    if (!confirm(`Are you sure you want to renounce this role? This cannot be undone without an admin granting it back.`)) return;
    setRenounceTx({ status: 'pending' });
    try {
      const c = new Contract(contractAddr, AccessControlABI, evm.signer);
      const tx = await c.renounceRole(roleHash, evm.address);
      await tx.wait();
      setRenounceTx({ status: 'success', hash: tx.hash });
      void handleCheck();
    } catch (e) {
      setRenounceTx({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const isAdmin = myRoles.get('0x0000000000000000000000000000000000000000000000000000000000000000') === true;
  const wrongChain = evm.isConnected && evm.chainId !== activeChainId;

  // Group holders by role
  const holdersByRole = new Map<string, RoleHolder[]>();
  for (const h of holders) {
    if (!holdersByRole.has(h.roleLabel)) holdersByRole.set(h.roleLabel, []);
    holdersByRole.get(h.roleLabel)!.push(h);
  }

  const sidebarContent = (
    <>
      {/* Role Holders — sidebar */}
      <Section icon="group" title="Role Holders" subtitle="On-chain role assignments"
        actions={
          <button className="btn btn-sm" onClick={handleScan} disabled={scanning || !contractAddr || !checked}>
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        }>
        {scanError && <div className="text-xs text-error mb-3">{scanError}</div>}
        {!checked && (
          <div className="text-xs text-on-surface-variant opacity-60 text-center py-4">Check a contract first</div>
        )}
        {checked && holders.length === 0 && !scanning && (
          <div className="text-xs text-on-surface-variant opacity-60 text-center py-4">Press Scan to find holders</div>
        )}
        {holdersByRole.size > 0 && (
          <div className="space-y-4">
            {[...holdersByRole.entries()].map(([roleLabel, rh]) => (
              <div key={roleLabel}>
                <div className="label mb-1">{roleLabel} ({rh.length})</div>
                <div className="space-y-1">
                  {rh.map((h) => (
                    <div key={h.account} className="flex items-center gap-2 bg-surface-container rounded px-3 py-2 border border-outline-variant/10">
                      <span className="text-xs text-secondary font-bold">✓</span>
                      <span className="font-mono text-[10px] text-on-surface break-all flex-1">{h.account}</span>
                      <a href={`https://${chain.explorer}/address/${h.account}`} target="_blank" rel="noreferrer"
                        className="text-[10px] text-primary hover:underline flex-shrink-0">↗</a>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Custom Roles — sidebar */}
      <Section icon="tag" title="Custom Roles" subtitle="Saved in browser, included in checks">
        <div className="flex gap-2 items-end mb-3">
          <div className="flex-1">
            <div className="label">Role name or hash</div>
            <input className="input" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="e.g. OPERATOR_ROLE" spellCheck={false}
              onKeyDown={(e) => { if (e.key === 'Enter') addCustomRole(); }} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={addCustomRole} disabled={!newRoleName.trim()}>Add</button>
        </div>
        {customRoles.length > 0 && (
          <div className="space-y-1">
            {customRoles.map((r) => (
              <div key={r.hash} className="flex items-center gap-2 bg-surface-container rounded px-2 py-1.5 border border-outline-variant/10 text-[11px]">
                <span className="font-mono font-semibold text-on-surface">{r.label}</span>
                <span className="flex-1" />
                <button className="text-error text-[10px] hover:underline" onClick={() => removeCustomRole(r.hash)}>✕</button>
              </div>
            ))}
          </div>
        )}
        {customRoles.length === 0 && (
          <div className="text-[11px] text-on-surface-variant opacity-60">No custom roles yet</div>
        )}
      </Section>
    </>
  );

  const mainContent = (
    <>
      {/* Contract setup */}
      <Section icon="security" title="AccessControl" subtitle="Manage roles on any OpenZeppelin AccessControl contract">
        {/* Network indicator */}
        <div className="flex items-center gap-3 mb-4">
          {evm.isConnected && walletChain && !manualChainId && (
            <ChainBadge chainId={walletChain.id} chainName={walletChain.name} status="connected" />
          )}
          {!evm.isConnected && (
            <span className="text-xs text-on-surface-variant">No wallet — select network</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <select className="input text-xs w-44" value={activeChainId}
              onChange={(e) => setManualChainId(Number(e.target.value))}>
              {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {manualChainId && (
              <button className="btn btn-sm" onClick={() => setManualChainId(null)}>Auto</button>
            )}
          </div>
        </div>

        {/* Wrong chain warning */}
        {wrongChain && (
          <div className="flex items-center gap-2 bg-tertiary/5 border border-tertiary/20 rounded-lg px-3 py-2 mb-4 text-xs text-tertiary">
            <span>Wallet is on {CHAINS.find((c) => c.id === evm.chainId)?.name ?? `chain ${evm.chainId}`}, but selected network is {chain.name}.</span>
            <button className="btn btn-sm" onClick={() => evm.switchNetwork(activeChainId)}>Switch wallet</button>
            <button className="btn btn-sm" onClick={() => setManualChainId(evm.chainId ?? null)}>Use wallet chain</button>
          </div>
        )}

        {/* Contract address + preset */}
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="label">Contract address</div>
            <input className="input" value={contractAddr} onChange={(e) => setContractAddr(e.target.value)} placeholder="0x…" spellCheck={false} />
          </div>
          <div className="w-44">
            <div className="label">Role preset</div>
            <select className="input" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
              {Object.keys(BUILTIN_PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleCheck} disabled={checking || !contractAddr}>
            {checking ? 'Checking…' : 'Check'}
          </button>
        </div>

        {error && <div className="text-xs text-error mt-2">{error}</div>}
        {checked && acSupport === 'yes' && <div className="text-xs text-secondary mt-2">✓ IAccessControl confirmed (ERC-165)</div>}
        {checked && acSupport === 'unknown' && <div className="text-xs text-on-surface-variant mt-2">ERC-165 not supported — hasRole calls succeeded</div>}
      </Section>

      {/* Your Roles */}
      {checked && evm.address && (
        <Section icon="badge" title="Your Roles" subtitle={`${evm.address.slice(0, 8)}…${evm.address.slice(-4)}`}>
          <div className="grid grid-cols-2 gap-2">
            {presetRoles.map((role) => {
              const has = myRoles.get(role.hash) === true;
              return (
                <div key={role.hash} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${has ? 'bg-secondary/10 text-secondary border-secondary/20' : 'bg-surface-container border-outline-variant/10 text-on-surface-variant/40'}`}>
                  <span className="font-bold">{has ? '✓' : '✗'}</span>
                  <span className="font-mono text-[11px] flex-1">{role.label}</span>
                  {has && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleRenounce(role.hash)}
                      disabled={renounceTx.status === 'pending'}>Renounce</button>
                  )}
                </div>
              );
            })}
          </div>
          {renounceTx.status !== 'idle' && <div className="mt-2"><TxStatus state={renounceTx} /></div>}
        </Section>
      )}

      {/* Grant / Revoke */}
      {checked && (
        <Section icon="admin_panel_settings" title={revokeMode ? 'Revoke Role' : 'Grant Role'}
          subtitle={isAdmin ? 'You have admin — can grant and revoke' : 'Requires DEFAULT_ADMIN_ROLE to execute'}
          actions={<button className="btn btn-sm" onClick={() => setRevokeMode((v) => !v)}>{revokeMode ? 'Switch to Grant' : 'Switch to Revoke'}</button>}>
          <div className="flex gap-3 items-end flex-wrap mb-3">
            <div className="flex-1 min-w-[180px]">
              <div className="label">Role</div>
              <select className="input" value={grantRoleHash} onChange={(e) => setGrantRoleHash(e.target.value)}>
                <option value="">Select…</option>
                {presetRoles.map((r) => <option key={r.hash} value={r.hash}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <div className="label">Account</div>
              <input className="input" value={grantAddr} onChange={(e) => setGrantAddr(e.target.value)} placeholder="0x…" spellCheck={false} />
            </div>
            <button className={`btn ${revokeMode ? 'btn-danger' : 'btn-primary'}`}
              disabled={!grantRoleHash || !grantAddr || grantTx.status === 'pending'}
              onClick={handleGrantRevoke}>
              {revokeMode ? 'Revoke' : 'Grant'}
            </button>
          </div>
          <TxStatus state={grantTx} />
        </Section>
      )}
    </>
  );

  return <PageLayout main={mainContent} sidebar={sidebarContent} />;
}
