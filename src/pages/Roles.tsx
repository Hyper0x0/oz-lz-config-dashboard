import { useState, useCallback, useEffect } from 'react';
import { Contract, JsonRpcProvider, Interface, keccak256, toUtf8Bytes } from 'ethers';
import { RpcProvider, Contract as StarkContract } from 'starknet';
import { getAllStarknetEvents, eventKey } from '@/utils/starknetEvents';
import { useWallet } from '@/context/WalletContext';
import { TxStatus } from '@/components/TxStatus';
import { Section } from '@/components/Section';
import { PageLayout } from '@/components/PageLayout';
import { SwitchChainButton } from '@/components/ChainSwitch';
import { AddressPill } from '@/components/AddressPill';
import { Spinner } from '@/components/Spinner';
import { Icon, ICONS } from '@/components/Icon';
import { Badge } from '@/components/Badge';
import AccessControlABI from '@/abis/evm/AccessControl.json';
import StarkAccessControlABI from '@/abis/svm/AccessControl.json';
import { STARKNET_TESTNET, STARKNET_MAINNET, ARBISCAN_API_KEY } from '@/config/chains';
import { getStarknetMainnetRpc, getStarknetSepoliaRpc } from '@/pages/Settings';
import { decodeContractError, extractErrorDetails } from '@/utils/decodeError';
import type { TxState } from '@/types';

// ── Known role presets ──────────────────────────────────────────────────────

type ChainType = 'evm' | 'starknet';

interface RolePreset { label: string; hash: string; cairoHash?: string }

/** Starknet sn_keccak: keccak256 masked to 250 bits, as hex felt. */
function snKeccak(name: string): string {
  const full = keccak256(toUtf8Bytes(name));
  const masked = BigInt(full) & ((1n << 250n) - 1n);
  return '0x' + masked.toString(16);
}

function makePreset(label: string, evmHash?: string): RolePreset {
  const hash = evmHash ?? keccak256(toUtf8Bytes(label));
  const cairoHash = label === 'DEFAULT_ADMIN_ROLE' ? '0x0' : snKeccak(label);
  return { label, hash, cairoHash };
}

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

const BUILTIN_PRESETS: Record<string, RolePreset[]> = {
  'TimelockController': [
    makePreset('DEFAULT_ADMIN_ROLE', ZERO_HASH),
    makePreset('PROPOSER_ROLE'),
    makePreset('EXECUTOR_ROLE'),
    makePreset('CANCELLER_ROLE'),
  ],
  'OFT / OApp': [
    makePreset('DEFAULT_ADMIN_ROLE', ZERO_HASH),
    makePreset('MINTER_ROLE'),
    makePreset('PAUSER_ROLE'),
    makePreset('UPGRADER_ROLE'),
  ],
  'Common': [
    makePreset('DEFAULT_ADMIN_ROLE', ZERO_HASH),
    makePreset('MINTER_ROLE'),
    makePreset('BURNER_ROLE'),
    makePreset('PAUSER_ROLE'),
    makePreset('UPGRADER_ROLE'),
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

// ── Chain lists ─────────────────────────────────────────────────────────────

const EVM_CHAINS = [
  { id: 1,        name: 'Ethereum',         rpc: 'https://eth.llamarpc.com',                    explorer: 'etherscan.io',             isTestnet: false },
  { id: 42161,    name: 'Arbitrum',          rpc: 'https://arb1.arbitrum.io/rpc',                explorer: 'arbiscan.io',              isTestnet: false },
  { id: 10,       name: 'Optimism',          rpc: 'https://mainnet.optimism.io',                 explorer: 'optimistic.etherscan.io',  isTestnet: false },
  { id: 8453,     name: 'Base',              rpc: 'https://mainnet.base.org',                    explorer: 'basescan.org',             isTestnet: false },
  { id: 137,      name: 'Polygon',           rpc: 'https://polygon-rpc.com',                     explorer: 'polygonscan.com',          isTestnet: false },
  { id: 56,       name: 'BNB Chain',         rpc: 'https://bsc-dataseed.binance.org',            explorer: 'bscscan.com',              isTestnet: false },
  { id: 43114,    name: 'Avalanche',         rpc: 'https://api.avax.network/ext/bc/C/rpc',       explorer: 'snowscan.xyz',             isTestnet: false },
  { id: 11155111, name: 'Sepolia',           rpc: 'https://rpc.sepolia.org',                     explorer: 'sepolia.etherscan.io',     isTestnet: true },
  { id: 421614,   name: 'Arbitrum Sepolia',  rpc: 'https://arbitrum-sepolia.publicnode.com',     explorer: 'sepolia.arbiscan.io',      isTestnet: true },
  { id: 11155420, name: 'Optimism Sepolia',  rpc: 'https://sepolia.optimism.io',                 explorer: 'sepolia-optimism.etherscan.io', isTestnet: true },
  { id: 84532,    name: 'Base Sepolia',      rpc: 'https://sepolia.base.org',                    explorer: 'sepolia.basescan.org',     isTestnet: true },
];

/** Resolve the Starknet chain entry with the user's RPC override from Settings applied at call time. */
function resolveStarkChain(isTestnet: boolean): { id: string; name: string; rpc: string; explorer: string } {
  if (isTestnet) {
    return { id: 'SN_SEPOLIA', name: 'Starknet Sepolia', rpc: getStarknetSepoliaRpc(STARKNET_TESTNET.rpc), explorer: 'sepolia.voyager.online' };
  }
  return { id: 'SN_MAIN', name: 'Starknet Mainnet', rpc: getStarknetMainnetRpc(STARKNET_MAINNET.rpc), explorer: 'voyager.online' };
}

// ── Types ───────────────────────────────────────────────────────────────────

interface RoleHolder { role: string; roleLabel: string; account: string }

// ── Component ───────────────────────────────────────────────────────────────

export function Roles(): JSX.Element {
  const { evm, stark } = useWallet();

  // Chain type toggle
  const [chainType, setChainType] = useState<ChainType>('evm');

  // Testnet/Mainnet toggle — filters EVM chains and auto-sets Starknet chain
  const [isTestnet, setIsTestnet] = useState(true);
  const filteredChains = EVM_CHAINS.filter((c) => c.isTestnet === isTestnet);
  const starkChain = resolveStarkChain(isTestnet);

  // EVM chain selection — defaults to the connected wallet's chain so navigating between pages
  // keeps you on it; an explicit in-page pick (this session) overrides until you change networks.
  const [pickedChainId, setPickedChainId] = useState<number | null>(null);
  const walletChainId = evm.isConnected && filteredChains.some((c) => c.id === evm.chainId) ? evm.chainId : null;
  const activeChainId = pickedChainId ?? walletChainId ?? 421614;
  const setActiveChainId = setPickedChainId;
  function handleNetworkToggle(testnet: boolean) {
    setIsTestnet(testnet);
    const first = EVM_CHAINS.find((c) => c.isTestnet === testnet);
    if (first) setPickedChainId(first.id);
  }
  const evmChain = filteredChains.find((c) => c.id === activeChainId) ?? filteredChains[0];

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

  /** Get the role hash appropriate for the current chain type. */
  function roleHash(role: RolePreset): string {
    return chainType === 'starknet' ? (role.cairoHash ?? snKeccak(role.label)) : role.hash;
  }

  function addCustomRole(): void {
    if (!newRoleName.trim()) return;
    const hash = computeHash(newRoleName.trim());
    if (customRoles.some((r) => r.hash === hash)) return; // duplicate
    const cairoHash = newRoleName.startsWith('0x') ? newRoleName : snKeccak(newRoleName.trim());
    const updated = [...customRoles, { label: newRoleName.trim(), hash, cairoHash }];
    setCustomRoles(updated);
    saveCustomRoles(updated);
    setNewRoleName('');
  }

  function removeCustomRole(hash: string): void {
    const updated = customRoles.filter((r) => r.hash !== hash);
    setCustomRoles(updated);
    saveCustomRoles(updated);
  }

  // Reset state when chain type changes
  useEffect(() => {
    setChecked(false);
    setError(null);
    setAcSupport('unknown');
    setHolders([]);
    setMyRoles(new Map());
    setGrantTx({ status: 'idle' });
    setRenounceTx({ status: 'idle' });
  }, [chainType]);

  const getEvmProvider = useCallback(() => {
    if (evm.provider && evm.chainId === evmChain.id) return evm.provider;
    return new JsonRpcProvider(evmChain.rpc);
  }, [evm.provider, evm.chainId, evmChain.id, evmChain.rpc]);

  // ── EVM Check ─────────────────────────────────────────────────────────
  async function handleEvmCheck(): Promise<void> {
    if (!contractAddr) return;
    setChecking(true);
    setError(null);
    setChecked(false);
    setAcSupport('unknown');
    setHolders([]);
    setMyRoles(new Map());
    try {
      const provider = getEvmProvider();
      const c = new Contract(contractAddr, AccessControlABI, provider);
      let supports: 'yes' | 'no' | 'unknown' = 'unknown';
      try {
        const result = await c.supportsInterface('0x7965db0b');
        supports = result ? 'yes' : 'no';
      } catch {
        supports = 'unknown';
      }
      setAcSupport(supports);
      if (supports === 'no') {
        setError('Contract explicitly returned false for IAccessControl interface');
        setChecking(false);
        return;
      }
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

  // ── Starknet Check ────────────────────────────────────────────────────
  async function handleStarkCheck(): Promise<void> {
    if (!contractAddr) return;
    setChecking(true);
    setError(null);
    setChecked(false);
    setAcSupport('unknown');
    setHolders([]);
    setMyRoles(new Map());
    try {
      const provider = new RpcProvider({ nodeUrl: starkChain.rpc });
      const c = new StarkContract(StarkAccessControlABI, contractAddr, provider);

      const walletAddr = stark.address;
      if (walletAddr) {
        const roleMap = new Map<string, boolean>();
        let anyWorked = false;
        for (const role of presetRoles) {
          const rh = roleHash(role);
          try {
            const has = await c.call('has_role', [rh, walletAddr]);
            roleMap.set(role.hash, Boolean(has));
            anyWorked = true;
          } catch {
            roleMap.set(role.hash, false);
          }
        }
        setMyRoles(roleMap);
        if (!anyWorked) {
          setError('Contract does not appear to implement AccessControl — has_role calls failed');
          setChecking(false);
          return;
        }
      }
      setAcSupport('yes');
      setChecked(true);
    } catch (e) {
      setError(decodeContractError(e));
    } finally {
      setChecking(false);
    }
  }

  function handleCheck(): void {
    if (chainType === 'starknet') void handleStarkCheck();
    else void handleEvmCheck();
  }

  // ── Starknet Scan events ──────────────────────────────────────────────
  async function handleStarkScan(): Promise<void> {
    if (!contractAddr) return;
    setScanning(true);
    setScanError(null);
    try {
      // Default from-block: latest - 100k blocks (~35 days on Starknet).
      let fromBlock: number | undefined;
      try {
        const provider = new RpcProvider({ nodeUrl: starkChain.rpc });
        const latest = await provider.getBlockLatestAccepted();
        fromBlock = Math.max(0, latest.block_number - 100000);
      } catch { /* leave undefined */ }

      const events = await getAllStarknetEvents(
        starkChain.rpc,
        contractAddr,
        ['RoleGranted', 'RoleRevoked'],
        fromBlock,
      );

      const GRANTED = eventKey('RoleGranted');
      const REVOKED = eventKey('RoleRevoked');
      const norm = (h: string): string => '0x' + BigInt(h).toString(16);
      // OZ Cairo AccessControl emits all event fields as data:
      //   keys = [event_selector], data = [role, account, sender]
      // Some forks promote `role` and `account` to keys; handle both layouts.
      const readRoleAndAccount = (ev: { keys: string[]; data: string[] }): { role: string; account: string } | null => {
        if (ev.keys.length >= 3) return { role: norm(ev.keys[1]), account: norm(ev.keys[2]) };
        if (ev.data.length >= 2) return { role: norm(ev.data[0]), account: norm(ev.data[1]) };
        return null;
      };

      const roleAccounts = new Map<string, Set<string>>();
      for (const ev of events) {
        const k0 = norm(ev.keys[0]);
        const parsed = readRoleAndAccount(ev);
        if (!parsed) continue;
        if (k0 === norm(GRANTED)) {
          if (!roleAccounts.has(parsed.role)) roleAccounts.set(parsed.role, new Set());
          roleAccounts.get(parsed.role)!.add(parsed.account.toLowerCase());
        } else if (k0 === norm(REVOKED)) {
          roleAccounts.get(parsed.role)?.delete(parsed.account.toLowerCase());
        }
      }

      const result: RoleHolder[] = [];
      for (const [rh, accounts] of roleAccounts) {
        const preset = presetRoles.find((p) => {
          const phash = norm(p.cairoHash ?? snKeccak(p.label));
          return phash === rh;
        });
        const label = preset?.label ?? `0x${rh.slice(2, 10)}…`;
        for (const account of accounts) {
          result.push({ role: rh, roleLabel: label, account });
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

  function handleScanClick(): void {
    if (chainType === 'starknet') void handleStarkScan();
    else void handleScan();
  }

  // ── EVM Scan events ───────────────────────────────────────────────────
  async function handleScan(): Promise<void> {
    if (!contractAddr || chainType === 'starknet') return;
    setScanning(true);
    setScanError(null);
    try {
      const iface = new Interface(AccessControlABI);
      const grantedTopic = iface.getEvent('RoleGranted')!.topicHash;
      const revokedTopic = iface.getEvent('RoleRevoked')!.topicHash;
      const base = `https://api.etherscan.io/v2/api?chainid=${evmChain.id}&module=logs&action=getLogs&address=${contractAddr}&fromBlock=0&toBlock=latest&apikey=${ARBISCAN_API_KEY}`;

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
      for (const [rh, accounts] of roleAccounts) {
        const preset = presetRoles.find((p) => p.hash.toLowerCase() === rh.toLowerCase());
        const label = preset?.label ?? `0x${rh.slice(2, 10)}…`;
        for (const account of accounts) {
          result.push({ role: rh, roleLabel: label, account });
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
    if (!contractAddr || !grantRoleHash || !grantAddr) return;

    if (chainType === 'starknet') {
      if (!stark.account) return;
      setGrantTx({ status: 'pending' });
      try {
        // Find the cairo hash for the selected role
        const preset = presetRoles.find((r) => r.hash === grantRoleHash);
        const cairoRH = preset?.cairoHash ?? grantRoleHash;
        const entrypoint = revokeMode ? 'revoke_role' : 'grant_role';
        const response = await stark.account.execute([{
          contractAddress: contractAddr,
          entrypoint,
          calldata: [cairoRH, grantAddr],
        }]);
        await stark.account.waitForTransaction(response.transaction_hash);
        setGrantTx({ status: 'success', hash: response.transaction_hash });
        void handleStarkCheck();
      } catch (e) {
        const fn = revokeMode ? 'revoke_role' : 'grant_role';
        setGrantTx({ status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr, functionName: fn, functionCall: `${fn}(${grantRoleHash}, ${grantAddr})` }) });
      }
      return;
    }

    // EVM
    if (!evm.signer) return;
    setGrantTx({ status: 'pending' });
    try {
      const c = new Contract(contractAddr, AccessControlABI, evm.signer);
      const tx = revokeMode
        ? await c.revokeRole(grantRoleHash, grantAddr)
        : await c.grantRole(grantRoleHash, grantAddr);
      await tx.wait();
      setGrantTx({ status: 'success', hash: tx.hash });
      void handleEvmCheck();
      void handleScan();
    } catch (e) {
      const fn = revokeMode ? 'revokeRole' : 'grantRole';
      setGrantTx({ status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr, functionName: fn, functionCall: `${fn}(${grantRoleHash}, ${grantAddr})` }) });
    }
  }

  async function handleRenounce(role: RolePreset): Promise<void> {
    if (!contractAddr) return;

    if (chainType === 'starknet') {
      if (!stark.account || !stark.address) return;
      if (!confirm('Are you sure you want to renounce this role? This cannot be undone without an admin granting it back.')) return;
      setRenounceTx({ status: 'pending' });
      const cairoRH = role.cairoHash ?? snKeccak(role.label);
      try {
        const response = await stark.account.execute([{
          contractAddress: contractAddr,
          entrypoint: 'renounce_role',
          calldata: [cairoRH, stark.address],
        }]);
        await stark.account.waitForTransaction(response.transaction_hash);
        setRenounceTx({ status: 'success', hash: response.transaction_hash });
        void handleStarkCheck();
      } catch (e) {
        setRenounceTx({ status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr, functionName: 'renounce_role', functionCall: `renounce_role(${cairoRH}, ${stark.address})` }) });
      }
      return;
    }

    // EVM
    if (!evm.signer || !evm.address) return;
    if (!confirm('Are you sure you want to renounce this role? This cannot be undone without an admin granting it back.')) return;
    setRenounceTx({ status: 'pending' });
    try {
      const c = new Contract(contractAddr, AccessControlABI, evm.signer);
      const tx = await c.renounceRole(role.hash, evm.address);
      await tx.wait();
      setRenounceTx({ status: 'success', hash: tx.hash });
      void handleEvmCheck();
    } catch (e) {
      setRenounceTx({ status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr, functionName: 'renounceRole', functionCall: `renounceRole(${role.hash}, ${evm.address})` }) });
    }
  }

  const walletAddr = chainType === 'starknet' ? stark.address : evm.address;
  const isAdmin = myRoles.get(ZERO_HASH) === true;
  const myRoleCount = presetRoles.filter((r) => myRoles.get(r.hash) === true).length;
  const wrongChain = chainType === 'evm' && evm.isConnected && evm.chainId !== evmChain.id;
  const explorer = chainType === 'starknet' ? starkChain.explorer : evmChain.explorer;

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
          <button className="btn btn-sm" onClick={handleScanClick} disabled={scanning || !contractAddr || !checked}>
            {scanning ? <><Spinner size="sm" /> Scanning…</> : 'Scan'}
          </button>
        }>
        <div className="min-h-[200px]">
        {scanError && <div className="text-xs text-error mb-3">{scanError}</div>}
        {!checked && (
          <div className="min-h-[180px] flex flex-col items-center justify-center gap-2 text-xs text-on-surface-variant text-center">
            <Icon name="group" size={22} className="opacity-40" />
            <span>Check a contract first</span>
          </div>
        )}
        {checked && holders.length === 0 && !scanning && (
          <div className="min-h-[180px] flex items-center justify-center text-xs text-on-surface-variant text-center">Press Scan to find holders</div>
        )}
        {scanning && (
          <div className="min-h-[180px] flex items-center justify-center"><Spinner size="md" /></div>
        )}
        {holdersByRole.size > 0 && (
          <div className="space-y-4 reveal">
            {[...holdersByRole.entries()].map(([roleLabel, rh]) => (
              <div key={roleLabel}>
                <div className="label mb-1">{roleLabel} ({rh.length})</div>
                <div className="space-y-1">
                  {rh.map((h) => (
                    <div key={h.account} className="flex items-center gap-2 subpanel rounded px-3 py-2">
                      <Icon name={ICONS.success} size={14} className="text-secondary" />
                      <div className="flex-1 min-w-0">
                        <AddressPill
                          address={h.account}
                          chain={chainType === 'starknet' ? 'starknet' : 'evm'}
                          chainId={chainType === 'evm' ? evmChain.id : undefined}
                          explorerUrl={`https://${explorer}/address/`}
                          size="sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
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
              <div key={r.hash} className="flex items-center gap-2 subpanel rounded px-2 py-1.5 text-[11px]">
                <span className="font-mono font-semibold text-on-surface">{r.label}</span>
                <span className="flex-1" />
                <button className="text-error hover:text-error/80 inline-flex items-center" onClick={() => removeCustomRole(r.hash)} title="Remove" aria-label="Remove role"><Icon name={ICONS.close} size={14} /></button>
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
      <Section icon="security" title="AccessControl" subtitle="Manage roles on any OpenZeppelin AccessControl contract"
        actions={checked && walletAddr ? (
          isAdmin
            ? <Badge variant="stark" icon="badge">You · ADMIN</Badge>
            : <Badge variant={myRoleCount > 0 ? 'success' : 'neutral'} icon="badge">You · {myRoleCount > 0 ? `${myRoleCount} role${myRoleCount > 1 ? 's' : ''}` : 'no roles'}</Badge>
        ) : undefined}>
        {/* Chain type toggle + network mode */}
        <div className="flex gap-2 items-center mb-4 flex-wrap">
          <div className="segmented">
            <button className={`tab-btn ${chainType === 'evm' ? 'tab-btn-active' : ''}`}
              onClick={() => setChainType('evm')}>EVM</button>
            <button className={`tab-btn ${chainType === 'starknet' ? 'tab-btn-active' : ''}`}
              onClick={() => setChainType('starknet')}>Starknet</button>
          </div>

          <div className="segmented">
            <button className={`tab-btn ${isTestnet ? 'tab-btn-active' : ''}`}
              onClick={() => handleNetworkToggle(true)}>Testnet</button>
            <button className={`tab-btn ${!isTestnet ? 'tab-btn-active' : ''}`}
              onClick={() => handleNetworkToggle(false)}>Mainnet</button>
          </div>

          {chainType === 'evm' && (
            <div className="ml-auto flex items-center gap-2">
              <select className="input text-xs w-44" value={evmChain.id}
                onChange={(e) => setActiveChainId(Number(e.target.value))}>
                {filteredChains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {wrongChain && (
                <SwitchChainButton chainName={evmChain.name} onSwitch={() => evm.switchNetwork(evmChain.id)} />
              )}
            </div>
          )}
          {chainType === 'starknet' && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-on-surface-variant">{starkChain.name}</span>
              {stark.isConnected && <span className="flex items-center gap-1.5 text-xs text-tertiary"><span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>Connected</span>}
            </div>
          )}
        </div>

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
        {checked && acSupport === 'yes' && chainType === 'evm' && <div className="text-xs text-secondary mt-2">✓ IAccessControl confirmed (ERC-165)</div>}
        {checked && acSupport === 'unknown' && chainType === 'evm' && <div className="text-xs text-on-surface-variant mt-2">ERC-165 not supported — hasRole calls succeeded</div>}
        {checked && chainType === 'starknet' && <div className="text-xs text-secondary mt-2">✓ AccessControl confirmed — has_role calls succeeded</div>}
      </Section>

      {/* Empty state — fills the canvas before a contract is inspected */}
      {!checked && (
        <div className="panel flex flex-col items-center justify-center text-center gap-4 px-8 py-16">
          <div className="panel-glyph w-14 h-14">
            <Icon name="admin_panel_settings" size={26} className="text-primary/70" />
          </div>
          <div className="max-w-sm">
            <div className="font-headline text-sm font-semibold text-on-surface">No contract loaded</div>
            <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
              Enter an OpenZeppelin <span className="font-mono text-on-surface/80">AccessControl</span> address above and
              press <span className="text-primary">Check</span> to inspect its role assignments, your own roles, and
              grant / revoke access.
            </p>
          </div>
        </div>
      )}

      {/* Your Roles */}
      {checked && walletAddr && (
        <Section icon="badge" title="Your Roles" subtitle={`${walletAddr.slice(0, 8)}…${walletAddr.slice(-4)}`}>
          <div className="grid grid-cols-2 gap-2">
            {presetRoles.map((role) => {
              const has = myRoles.get(role.hash) === true;
              return (
                <div key={role.hash} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${has ? 'bg-secondary/10 text-secondary border-secondary/20' : 'bg-surface-container border-outline-variant/10 text-on-surface-variant/40'}`}>
                  <Icon name={has ? ICONS.success : ICONS.error} size={15} />
                  <span className="font-mono text-[11px] flex-1">{role.label}</span>
                  {has && !wrongChain && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleRenounce(role)}
                      disabled={renounceTx.status === 'pending'}>Renounce</button>
                  )}
                  {has && wrongChain && (
                    <SwitchChainButton chainName={evmChain.name} onSwitch={() => evm.switchNetwork(evmChain.id)} />
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
            {wrongChain ? (
              <SwitchChainButton chainName={evmChain.name} onSwitch={() => evm.switchNetwork(evmChain.id)} />
            ) : (
              <button className={`btn ${revokeMode ? 'btn-danger' : 'btn-primary'}`}
                disabled={!grantRoleHash || !grantAddr || grantTx.status === 'pending'}
                onClick={handleGrantRevoke}>
                {revokeMode ? 'Revoke' : 'Grant'}
              </button>
            )}
          </div>
          <TxStatus state={grantTx} />
        </Section>
      )}
    </>
  );

  return <PageLayout main={mainContent} sidebar={sidebarContent} />;
}
