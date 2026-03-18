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
  peers(eid: number): Promise<string>;
  enforcedOptions(eid: number, msgType: number): Promise<string>;
  setPeer(eid: number, peer: string): Promise<ContractTransactionResponse>;
  setEnforcedOptions(params: EnforcedOptionParam[]): Promise<ContractTransactionResponse>;
  setDelegate(delegate: string): Promise<ContractTransactionResponse>;
}

export interface IAdminGateway {
  getMinDelay(): Promise<bigint>;
  getTimestamp(id: string): Promise<bigint>;
  getOperationState(id: string): Promise<number>;
  hashOperation(target: string, value: bigint, data: string, predecessor: string, salt: string): Promise<string>;
  schedule(target: string, value: bigint, data: string, predecessor: string, salt: string, delay: bigint): Promise<ContractTransactionResponse>;
  execute(target: string, value: bigint, payload: string, predecessor: string, salt: string): Promise<ContractTransactionResponse>;
  cancel(id: string): Promise<ContractTransactionResponse>;
}

/** VaultState mirrors the Solidity enum VaultState */
export enum VaultState {
  Pending = 0,
  Active = 1,
  Deprecated = 2,
  Closed = 3,
}

export type OperationState = 'Unset' | 'Waiting' | 'Ready' | 'Done';
