export type TxState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; hash: string }
  | { status: 'error'; message: string };

export interface ChainConfig {
  id: number;
  eid: number;
  name: string;
  rpc: string;
}

export interface EnforcedOptionParam {
  eid: number;
  msgType: number;
  options: string;
}

export interface RateLimitConfig {
  dstEid: number;
  limit: bigint;
  window: number;
}

export interface RateLimitState {
  amountInFlight: bigint;
  lastUpdated: number;
  limit: bigint;
  window: number;
}

export interface AdapterState {
  owner: string;
  token: string;
  peer: string;
  enforcedOptionsSend: string;
  rateLimit: RateLimitState;
  amountInFlight: bigint;
  amountCanBeSent: bigint;
}

export interface PeerState {
  owner: string;
  peer: string;
  enforcedOptionsSend: string;
}

import type { ContractTransactionResponse } from 'ethers';

// ── Typed contract interfaces (for use with ethers Contract cast) ─────────────

export interface IOFTAdapter {
  owner(): Promise<string>;
  token(): Promise<string>;
  peers(eid: number): Promise<string>;
  enforcedOptions(eid: number, msgType: number): Promise<string>;
  rateLimits(eid: number): Promise<[bigint, bigint, bigint, bigint]>;
  getAmountCanBeSent(eid: number): Promise<[bigint, bigint]>;
  setPeer(eid: number, peer: string): Promise<ContractTransactionResponse>;
  setEnforcedOptions(params: EnforcedOptionParam[]): Promise<ContractTransactionResponse>;
  setRateLimits(configs: { dstEid: number; limit: bigint; window: number }[]): Promise<ContractTransactionResponse>;
  setDelegate(delegate: string): Promise<ContractTransactionResponse>;
}

export interface IOFTPeer {
  owner(): Promise<string>;
  name(): Promise<string>;
  symbol(): Promise<string>;
  peers(eid: number): Promise<string>;
  enforcedOptions(eid: number, msgType: number): Promise<string>;
  setPeer(eid: number, peer: string): Promise<ContractTransactionResponse>;
  setEnforcedOptions(params: EnforcedOptionParam[]): Promise<ContractTransactionResponse>;
  setDelegate(delegate: string): Promise<ContractTransactionResponse>;
}

export interface IERC20Read {
  name(): Promise<string>;
  symbol(): Promise<string>;
}

export interface DVNProvider {
  /** Canonical display name, e.g. "LayerZero Labs" */
  name: string;
  /** Contract address on this specific chain */
  address: string;
  /** Short colour key for the avatar (derived from name) */
  color: string;
  /** Optional logo URL — set for known providers, undefined for unknown */
  icon?: string;
}

export interface TokenInfo {
  /** Name of the underlying ERC-20 locked by the adapter (e.g. "Shift Yield Share USDC") */
  tokenName: string;
  tokenSymbol: string;
  /** Name / symbol of the peer OFT on the remote chain */
  peerName: string;
  peerSymbol: string;
}

export interface ITimelockController {
  getMinDelay(): Promise<bigint>;
  getTimestamp(id: string): Promise<bigint>;
  getOperationState(id: string): Promise<number>;
  hashOperation(target: string, value: bigint, data: string, predecessor: string, salt: string): Promise<string>;
  schedule(target: string, value: bigint, data: string, predecessor: string, salt: string, delay: bigint): Promise<ContractTransactionResponse>;
  execute(target: string, value: bigint, payload: string, predecessor: string, salt: string): Promise<ContractTransactionResponse>;
  cancel(id: string): Promise<ContractTransactionResponse>;
  // Role management
  PROPOSER_ROLE(): Promise<string>;
  EXECUTOR_ROLE(): Promise<string>;
  CANCELLER_ROLE(): Promise<string>;
  DEFAULT_ADMIN_ROLE(): Promise<string>;
  hasRole(role: string, account: string): Promise<boolean>;
  grantRole(role: string, account: string): Promise<ContractTransactionResponse>;
  revokeRole(role: string, account: string): Promise<ContractTransactionResponse>;
  renounceRole(role: string, callerConfirmation: string): Promise<ContractTransactionResponse>;
  getRoleAdmin(role: string): Promise<string>;
}

// ── LZ Verification ───────────────────────────────────────────────────────────

export interface UlnConfig {
  confirmations: bigint;
  requiredDVNCount: number;
  optionalDVNCount: number;
  optionalDVNThreshold: number;
  requiredDVNs: string[];
  optionalDVNs: string[];
}

export interface ExecutorConfig {
  maxMessageSize: number;
  executor: string;
}

export interface VerifyCheck {
  label: string;
  passed: boolean;
  detail: string;
  /** critical = blocks sends, warning = risky, info = informational */
  severity: 'critical' | 'warning' | 'info';
}

export interface PathwayVerifyResult {
  /** A→B send side (home) */
  homeSendLib: string | null;
  homeExecutor: ExecutorConfig | null;
  homeDVN: UlnConfig | null;
  homeDelegate: string | null;
  homePeer: string | null;
  homeEnforcedOptions: string | null;
  homeRateLimit?: { limit: bigint; window: number } | null;

  /** A→B receive side (remote) */
  remoteReceiveLib: string | null;
  remoteReceiveLibIsDefault: boolean;
  remoteDVN: UlnConfig | null;
  remotePeer: string | null;
  remoteEnforcedOptions: string | null;

  /** B→A send side (remote) */
  remoteSendLib: string | null;
  remoteExecutor: ExecutorConfig | null;
  remoteSendDVN: UlnConfig | null;
  remoteDelegate: string | null;

  /** B→A receive side (home) */
  homeReceiveLib: string | null;
  homeReceiveLibIsDefault: boolean;
  homeReceiveDVN: UlnConfig | null;

  /** EID support */
  remoteEidSupported: boolean;
  homeEidSupported: boolean;

  checks: VerifyCheck[];
  error: string | null;
}

/** VaultState mirrors the Solidity enum VaultState */
export enum VaultState {
  Pending = 0,
  Active = 1,
  Deprecated = 2,
  Closed = 3,
}

export type OperationState = 'Unset' | 'Waiting' | 'Ready' | 'Done';

export interface PeerEntry {
  eid: number;
  name: string;
  /** Chain key for icon resolution (e.g. 'arbitrum', 'ethereum') */
  chainKey?: string;
  /** bytes32 hex (EVM) or felt hex (Starknet) — null means zero / not set */
  peer: string | null;
  error?: boolean;
}
