import { useCallback } from 'react';
import { RpcProvider, CallData, validateAndParseAddress } from 'starknet';
import type { WalletAccount } from 'starknet';
import type { TxState, PeerEntry } from '@/types';
import { decodeContractError, extractErrorDetails } from '@/utils/decodeError';

/**
 * Normalize a Starknet address to its canonical 0x-prefixed 64-hex form.
 * Required because some addresses are stored/passed without leading zeros and
 * RPC calls (especially callContract) reject the short form on certain providers.
 */
function normalizeStarkAddr(addr: string): string {
  try { return validateAndParseAddress(addr); } catch { return addr; }
}

/** Classify a Starknet RPC error into a kind the caller can branch on. */
function classifyStarkRpcError(e: unknown): 'entrypoint_missing' | 'contract_missing' | 'rpc_error' {
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  if (msg.includes('entrypoint') || msg.includes('entry point') || msg.includes('not exist in the contract')) return 'entrypoint_missing';
  if ((msg.includes('contract') && msg.includes('not found')) || msg.includes('class hash')) return 'contract_missing';
  return 'rpc_error';
}

/** Retry an RPC call up to 3 times with exponential backoff on transient RPC errors.
 *  Does NOT retry on entrypoint_missing or contract_missing — those are deterministic. */
async function retryOnRpcFlake<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const kind = classifyStarkRpcError(e);
      if (kind !== 'rpc_error') throw e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Run a list of async tasks with bounded concurrency. Used to avoid hammering Stark RPCs. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = { status: 'fulfilled', value: await fn(items[i], i) }; }
      catch (reason) { results[i] = { status: 'rejected', reason }; }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Try once, then retry once after a short delay if it throws. Catches transient RPC rate limits. */
async function withRetry<T>(fn: () => Promise<T>, delayMs = 250): Promise<T> {
  try { return await fn(); }
  catch {
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}

/** Convert an EVM address (0x hex) to the Bytes32 low/high calldata for Cairo set_peer. */
function evmAddrToBytes32Calldata(evmAddr: string): [string, string] {
  const value = BigInt(evmAddr);
  const low  = (value & BigInt('0xffffffffffffffffffffffffffffffff')).toString();
  const high = (value >> BigInt(128)).toString();
  return [low, high];
}

/** Encode a bigint as u256 calldata [low, high]. */
function encodeU256(value: bigint): [string, string] {
  const low  = (value & ((1n << 128n) - 1n)).toString();
  const high = (value >> 128n).toString();
  return [low, high];
}

/**
 * Read the peer bytes32 stored for a given EID from a Cairo OFT, returned as a hex string.
 * Throws on RPC failure so callers (e.g. readAllPeers' retry layer) can distinguish "peer is zero"
 * from "the call itself failed".
 */
async function readCairoPeer(cairoOftAddr: string, eid: number, rpc: string): Promise<string | null> {
  const provider = new RpcProvider({ nodeUrl: rpc });
  const result = await provider.callContract({
    contractAddress: normalizeStarkAddr(cairoOftAddr),
    entrypoint: 'get_peer',
    calldata: CallData.compile([eid]),
  }, 'latest');
  const low  = BigInt(result[0]);
  const high = BigInt(result[1]);
  const value = (high << BigInt(128)) | low;
  if (value === 0n) return null;
  return '0x' + value.toString(16).padStart(64, '0');
}

export interface CairoOFTState {
  peer: string | null;   // bytes32 hex — the EVM Bridge address stored on-chain
  loading: boolean;
  error: string | null;
}

export interface CairoOFTOps {
  readPeer: (cairoOftAddr: string, evmEid: number, rpc: string) => Promise<CairoOFTState>;
  /** Query get_peer for every entry in eidList in parallel. Returns PeerEntry[]. */
  readAllPeers: (cairoOftAddr: string, eidList: Array<{ eid: number; name: string }>, rpc: string, onProgress?: (done: number, total: number) => void) => Promise<PeerEntry[]>;
  /** Read enforced options from the Cairo OFT. Returns true if non-empty ByteArray is set. */
  /** Returns the enforced options as a hex string (LZ options format), or null if not set. */
  readEnforcedOptions: (cairoOftAddr: string, evmEid: number, rpc: string) => Promise<string | null>;
  setPeer: (cairoOftAddr: string, evmEid: number, evmBridgeAddr: string) => Promise<TxState>;
  /** Quote the LZ fee for a Cairo OFT send */
  cairoQuoteSend: (cairoOftAddr: string, dstEid: number, toEvmAddr: string, amountLD: bigint, minAmountLD: bigint, rpc: string) => Promise<{ nativeFee: bigint; lzTokenFee: bigint }>;
  /** Approve fee token (ETH/STRK) and optionally the adapter's underlying ERC20, in a single multicall. */
  cairoApprove: (cairoOftAddr: string, feeTokenAddr: string, nativeFee: bigint, underlyingTokenAddr?: string, amountLD?: bigint) => Promise<TxState>;
  /** Execute a cross-chain send from Cairo OFT. Approvals must be done beforehand via cairoApprove. */
  cairoSend: (cairoOftAddr: string, dstEid: number, toEvmAddr: string, amountLD: bigint, minAmountLD: bigint, fee: { nativeFee: bigint; lzTokenFee: bigint }) => Promise<TxState>;
  /** Read OFT balance for a Starknet account */
  cairoBalance: (cairoOftAddr: string, owner: string, rpc: string) => Promise<bigint>;
  readCairoTokenInfo: (addr: string, rpc: string) => Promise<{ name: string; symbol: string }>;
  /** Read ERC20 decimals() from a Cairo token. Returns null if the call fails or the entrypoint is missing. */
  readCairoTokenDecimals: (addr: string, rpc: string) => Promise<number | null>;
  detectCairoOFTType: (addr: string, rpc: string) => Promise<{ type: 'adapter' | 'oft' | 'unknown'; tokenAddr: string | null; error: string | null }>;
  /** Read outbound rate limit for a Starknet OFT adapter (ignoring amount_in_flight / last_updated). */
  readOutboundRateLimit: (cairoOftAddr: string, dstEid: number, rpc: string) => Promise<{ limit: bigint; window: number } | null>;
  /** Read inbound rate limit. */
  readInboundRateLimit: (cairoOftAddr: string, srcEid: number, rpc: string) => Promise<{ limit: bigint; window: number } | null>;
  /** Write outbound rate limit for (dst_eid). Passes direction=Outbound. */
  setCairoRateLimit: (cairoOftAddr: string, dstEid: number, limit: bigint, window: number) => Promise<TxState>;
}

export function useCairoOFT(account: WalletAccount | null): CairoOFTOps {
  const readPeer = useCallback(async (cairoOftAddr: string, evmEid: number, rpc: string): Promise<CairoOFTState> => {
    try {
      const peer = await readCairoPeer(cairoOftAddr, evmEid, rpc);
      return { peer, loading: false, error: null };
    } catch (e) {
      return { peer: null, loading: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  const readAllPeers = useCallback(async (cairoOftAddr: string, eidList: Array<{ eid: number; name: string }>, rpc: string, onProgress?: (done: number, total: number) => void): Promise<PeerEntry[]> => {
    // Bounded concurrency + retry — Stark RPCs throttle dozens of parallel callContract calls
    // and previously dropped random entries from the result.
    let done = 0;
    const settled = await mapLimit(eidList, 4, async (item) => {
      try { return await withRetry(() => readCairoPeer(cairoOftAddr, item.eid, rpc)); }
      finally { onProgress?.(++done, eidList.length); }
    });
    return eidList.map((item, i) => {
      const res = settled[i];
      if (res.status === 'rejected') return { ...item, peer: null, error: true };
      return { ...item, peer: res.value };  // null when zero
    });
  }, []);

  const readEnforcedOptions = useCallback(async (cairoOftAddr: string, evmEid: number, rpc: string): Promise<string | null> => {
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      const result = await provider.callContract({
        contractAddress: normalizeStarkAddr(cairoOftAddr),
        entrypoint: 'get_enforced_options',
        calldata: CallData.compile([evmEid, 1 /* MSG_TYPE_SEND */]),
      }, 'latest');
      // Raw result for ByteArray: [data_len, ...data_felts, pending_word, pending_word_len]
      if (!result || result.length === 0) return null;
      const dataLen = Number(result[0]);
      const pendingWord = result[1 + dataLen];
      const pendingWordLen = Number(result[2 + dataLen] ?? 0);
      const isEmpty = dataLen === 0 && (pendingWordLen === 0 || BigInt(pendingWord) === 0n);
      if (isEmpty) return null;
      // Reconstruct hex from ByteArray felts
      let hex = '';
      for (let i = 1; i <= dataLen; i++) {
        const felt = BigInt(result[i]);
        hex += felt.toString(16).padStart(62, '0'); // 31 bytes = 62 hex chars
      }
      if (pendingWordLen > 0 && BigInt(pendingWord) !== 0n) {
        hex += BigInt(pendingWord).toString(16).padStart(pendingWordLen * 2, '0');
      }
      return '0x' + hex;
    } catch {
      return null;
    }
  }, []);

  const setPeer = useCallback(async (cairoOftAddr: string, evmEid: number, evmBridgeAddr: string): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const [low, high] = evmAddrToBytes32Calldata(evmBridgeAddr);
      const response = await account.execute([{
        contractAddress: normalizeStarkAddr(cairoOftAddr),
        entrypoint: 'set_peer',
        calldata: [evmEid.toString(), low, high],
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: cairoOftAddr, functionName: 'set_peer', functionCall: `set_peer(${evmEid}, bytes32(${evmBridgeAddr}))` }) };
    }
  }, [account]);

  // ── Send / Transfer ──────────────────────────────────────────────────────

  const cairoQuoteSend = useCallback(async (
    cairoOftAddr: string,
    dstEid: number,
    toEvmAddr: string,
    amountLD: bigint,
    minAmountLD: bigint,
    rpc: string,
  ): Promise<{ nativeFee: bigint; lzTokenFee: bigint }> => {
    // Try with the wallet's provider first (better rate limits), then public RPC
    const providers = [
      ...(account ? [account] : []),
      new RpcProvider({ nodeUrl: rpc }),
    ];
    const [toLow, toHigh] = evmAddrToBytes32Calldata(toEvmAddr);
    const emptyBA = ['0', '0x0', '0']; // empty ByteArray: data_len=0, pending_word=0, pending_word_len=0
    const calldata = [
      // SendParam
      dstEid.toString(),                     // dst_eid
      toLow, toHigh,                         // to (Bytes32 = { value: u256 { low, high } })
      ...encodeU256(amountLD),               // amount_ld
      ...encodeU256(minAmountLD),            // min_amount_ld
      ...emptyBA,                            // extra_options
      ...emptyBA,                            // compose_msg
      ...emptyBA,                            // oft_cmd
      // pay_in_lz_token
      '0',
    ];
    let lastError: unknown;
    for (const provider of providers) {
      try {
        const result = await provider.callContract({
          contractAddress: normalizeStarkAddr(cairoOftAddr),
          entrypoint: 'quote_send',
          calldata,
        }, 'latest');
        // MessagingFee = { native_fee: u256, lz_token_fee: u256 }
        const nativeFee = (BigInt(result[1]) << 128n) | BigInt(result[0]);
        const lzTokenFee = (BigInt(result[3]) << 128n) | BigInt(result[2]);
        return { nativeFee, lzTokenFee };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }, [account]);

  const cairoApprove = useCallback(async (
    cairoOftAddr: string,
    feeTokenAddr: string,
    nativeFee: bigint,
    underlyingTokenAddr?: string,
    amountLD?: bigint,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }> = [];
      const oft = normalizeStarkAddr(cairoOftAddr);
      if (nativeFee > 0n) {
        calls.push({
          contractAddress: normalizeStarkAddr(feeTokenAddr),
          entrypoint: 'approve',
          calldata: [oft, ...encodeU256(nativeFee)],
        });
      }
      if (underlyingTokenAddr && amountLD && amountLD > 0n) {
        calls.push({
          contractAddress: normalizeStarkAddr(underlyingTokenAddr),
          entrypoint: 'approve',
          calldata: [oft, ...encodeU256(amountLD)],
        });
      }
      if (calls.length === 0) return { status: 'error', message: 'Nothing to approve' };
      const response = await account.execute(calls);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: feeTokenAddr, functionName: 'approve', functionCall: `approve(${cairoOftAddr}, fee=${nativeFee}${underlyingTokenAddr ? `, token=${underlyingTokenAddr}, amount=${amountLD}` : ''})` }) };
    }
  }, [account]);

  const cairoSend = useCallback(async (
    cairoOftAddr: string,
    dstEid: number,
    toEvmAddr: string,
    amountLD: bigint,
    minAmountLD: bigint,
    fee: { nativeFee: bigint; lzTokenFee: bigint },
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const [toLow, toHigh] = evmAddrToBytes32Calldata(toEvmAddr);
      const emptyBA = ['0', '0x0', '0']; // empty ByteArray

      const response = await account.execute([{
        contractAddress: normalizeStarkAddr(cairoOftAddr),
        entrypoint: 'send',
        calldata: [
          dstEid.toString(),
          toLow, toHigh,
          ...encodeU256(amountLD),
          ...encodeU256(minAmountLD),
          ...emptyBA, ...emptyBA, ...emptyBA,
          ...encodeU256(fee.nativeFee),
          ...encodeU256(fee.lzTokenFee),
          account.address,
        ],
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: cairoOftAddr, functionName: 'send (Cairo OFT)', functionCall: `send({ dstEid: ${dstEid}, to: ${toEvmAddr}, amountLD: ${amountLD}, minAmountLD: ${minAmountLD} }, { nativeFee: ${fee.nativeFee}, lzTokenFee: ${fee.lzTokenFee} })` }) };
    }
  }, [account]);

  const cairoBalance = useCallback(async (cairoOftAddr: string, owner: string, rpc: string): Promise<bigint> => {
    // Raw callContract keeps parsing explicit and ABI-agnostic (works for any Cairo ERC20, not just the OFT ABI).
    const provider = new RpcProvider({ nodeUrl: rpc });
    const result = await provider.callContract({
      contractAddress: normalizeStarkAddr(cairoOftAddr),
      entrypoint: 'balance_of',
      calldata: CallData.compile([normalizeStarkAddr(owner)]),
    }, 'latest');
    const low  = BigInt(result[0] ?? '0');
    const high = BigInt(result[1] ?? '0');
    return low + (high << 128n);
  }, []);

  /** Read name + symbol from a Starknet contract (OFT or ERC20). Handles both felt252 and ByteArray returns. */
  const readCairoTokenInfo = useCallback(async (addr: string, rpc: string): Promise<{ name: string; symbol: string }> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const fallback = { name: addr.slice(0, 10) + '…', symbol: '' };
    const norm = normalizeStarkAddr(addr);
    try {
      const [nameResult, symbolResult] = await Promise.allSettled([
        provider.callContract({ contractAddress: norm, entrypoint: 'name', calldata: [] }, 'latest'),
        provider.callContract({ contractAddress: norm, entrypoint: 'symbol', calldata: [] }, 'latest'),
      ]);

      /**
       * Decode a Cairo string response which can be:
       * - Single felt252: [hex_string] — old ERC20 tokens (short string ≤31 bytes)
       * - ByteArray: [data_len, ...data_chunks, pending_word, pending_word_len] — new OZ tokens
       */
      function decodeStringResponse(result: string[]): string {
        if (!result || result.length === 0) return '';

        // Try ByteArray format first: result[0] = number of 31-byte chunks
        const dataLen = Number(result[0]);
        if (result.length >= dataLen + 3 && dataLen >= 0 && dataLen < 100) {
          // ByteArray: [data_len, chunk0..chunkN, pending_word, pending_word_len]
          let text = '';
          for (let i = 1; i <= dataLen; i++) {
            const chunk = result[i];
            if (chunk && chunk !== '0x0') {
              const clean = chunk.startsWith('0x') ? chunk.slice(2) : chunk;
              // Each chunk is a 31-byte felt — pad to 62 hex chars
              const padded = clean.padStart(62, '0');
              const bytes = new Uint8Array(padded.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
              text += new TextDecoder().decode(bytes).replace(/\0/g, '');
            }
          }
          // Pending word (remainder < 31 bytes)
          const pendingWord = result[dataLen + 1];
          const pendingLen = Number(result[dataLen + 2] ?? '0');
          if (pendingWord && pendingWord !== '0x0' && pendingLen > 0) {
            const clean = pendingWord.startsWith('0x') ? pendingWord.slice(2) : pendingWord;
            const padded = clean.padStart(pendingLen * 2, '0');
            const bytes = new Uint8Array(padded.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
            text += new TextDecoder().decode(bytes).replace(/\0/g, '');
          }
          if (text.trim()) return text.trim();
        }

        // Fallback: single felt252 (short string)
        const hex = result[0];
        const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
        if (!clean || clean === '0') return '';
        const bytes = new Uint8Array(clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
        return new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
      }

      const name = nameResult.status === 'fulfilled' ? decodeStringResponse(nameResult.value) : '';
      const symbol = symbolResult.status === 'fulfilled' ? decodeStringResponse(symbolResult.value) : '';
      return { name: name || fallback.name, symbol };
    } catch {
      return fallback;
    }
  }, []);

  const readCairoTokenDecimals = useCallback(async (addr: string, rpc: string): Promise<number | null> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    try {
      const result = await retryOnRpcFlake(() =>
        provider.callContract({
          contractAddress: normalizeStarkAddr(addr),
          entrypoint: 'decimals',
          calldata: [],
        }, 'latest'),
      );
      const raw = BigInt(result[0] ?? '0');
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= 32 ? n : null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Detect whether a Starknet OFT contract is an Adapter (has token()) or a native OFT.
   *
   * Distinguishes three outcomes:
   *  - 'adapter' — token() returned a different address (the underlying ERC20)
   *  - 'oft'     — token() returned self OR is missing, but oft_version() succeeds
   *  - 'unknown' — neither token() nor oft_version() resolved (RPC failure, wrong network, or non-OFT)
   *
   * `error` carries the reason on 'unknown', or a soft warning (e.g. "RPC flaked, assumed OFT").
   */
  const detectCairoOFTType = useCallback(async (addr: string, rpc: string): Promise<{ type: 'adapter' | 'oft' | 'unknown'; tokenAddr: string | null; error: string | null }> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const normalized = normalizeStarkAddr(addr);

    // 1. Try token() with retries on transient RPC errors. Entrypoint-missing fails fast.
    let tokenErr: 'entrypoint_missing' | 'contract_missing' | 'rpc_error' | null = null;
    try {
      const result = await retryOnRpcFlake(() =>
        provider.callContract({ contractAddress: normalized, entrypoint: 'token', calldata: [] }, 'latest'),
      );
      const tokenAddr = result[0];
      if (!tokenAddr || tokenAddr === '0x0') return { type: 'oft', tokenAddr: null, error: null };
      if (BigInt(normalized) === BigInt(tokenAddr)) return { type: 'oft', tokenAddr: null, error: null };
      return { type: 'adapter', tokenAddr: normalizeStarkAddr(tokenAddr), error: null };
    } catch (e) {
      tokenErr = classifyStarkRpcError(e);
      if (tokenErr === 'contract_missing') {
        return { type: 'unknown', tokenAddr: null, error: 'Contract not deployed at this address on the selected network' };
      }
    }

    // 2. token() didn't resolve — probe oft_version() as a liveness + OFT-ness check.
    try {
      await retryOnRpcFlake(() =>
        provider.callContract({ contractAddress: normalized, entrypoint: 'oft_version', calldata: [] }, 'latest'),
      );
      // It is an OFT; the earlier token() failure was either entrypoint-missing (plain OFT) or a persistent RPC flake.
      const softError = tokenErr === 'rpc_error' ? 'token() RPC still flaky after retries — treated as plain OFT' : null;
      return { type: 'oft', tokenAddr: null, error: softError };
    } catch (e) {
      const kind2 = classifyStarkRpcError(e);
      if (kind2 === 'contract_missing') {
        return { type: 'unknown', tokenAddr: null, error: 'Contract not deployed at this address on the selected network' };
      }
      if (kind2 === 'entrypoint_missing' && tokenErr === 'entrypoint_missing') {
        return { type: 'unknown', tokenAddr: null, error: 'Not an OFT — contract exposes neither token() nor oft_version()' };
      }
      const reason = String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200);
      return { type: 'unknown', tokenAddr: null, error: `Starknet RPC flaking — try another RPC in Settings. (${reason})` };
    }
  }, []);

  /** Shared helper for rate-limit entrypoints. Returns null on entrypoint_missing; propagates other errors. */
  const readRateLimitEntrypoint = async (
    cairoOftAddr: string, eid: number, rpc: string, entrypoint: 'get_outbound_rate_limit' | 'get_inbound_rate_limit',
  ): Promise<{ limit: bigint; window: number } | null> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    try {
      // RateLimit struct = [amount_in_flight: u128, last_updated: u64, limit: u128, window: u64]
      const result = await retryOnRpcFlake(() =>
        provider.callContract({
          contractAddress: normalizeStarkAddr(cairoOftAddr),
          entrypoint,
          calldata: CallData.compile([eid]),
        }, 'latest'),
      );
      const limit = BigInt(result[2] ?? '0');
      const window = Number(BigInt(result[3] ?? '0'));
      return { limit, window };
    } catch (e) {
      if (classifyStarkRpcError(e) === 'entrypoint_missing') return null;
      throw e;
    }
  };

  const readOutboundRateLimit = useCallback((cairoOftAddr: string, dstEid: number, rpc: string) =>
    readRateLimitEntrypoint(cairoOftAddr, dstEid, rpc, 'get_outbound_rate_limit'), []);

  const readInboundRateLimit = useCallback((cairoOftAddr: string, srcEid: number, rpc: string) =>
    readRateLimitEntrypoint(cairoOftAddr, srcEid, rpc, 'get_inbound_rate_limit'), []);

  const setCairoRateLimit = useCallback(async (
    cairoOftAddr: string, dstEid: number, limit: bigint, window: number,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      // set_rate_limits(rate_limits: Array<RateLimitConfig>, direction: RateLimitDirection)
      // Flat felt layout:
      //   [array_len, dst_eid, limit, window, direction_variant_idx (0=Outbound, 1=Inbound)]
      const calldata = [
        '0x1',                                      // array length = 1
        '0x' + dstEid.toString(16),                 // dst_eid: u32
        '0x' + limit.toString(16),                  // limit: u128
        '0x' + window.toString(16),                 // window: u64
        '0x0',                                      // RateLimitDirection::Outbound
      ];
      const response = await account.execute([{
        contractAddress: normalizeStarkAddr(cairoOftAddr),
        entrypoint: 'set_rate_limits',
        calldata,
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: cairoOftAddr, functionName: 'set_rate_limits', functionCall: `set_rate_limits([{ dst_eid: ${dstEid}, limit: ${limit}, window: ${window} }], Outbound)` }) };
    }
  }, [account]);

  return {
    readPeer, readAllPeers, readEnforcedOptions, setPeer,
    cairoQuoteSend, cairoApprove, cairoSend, cairoBalance,
    readCairoTokenInfo, readCairoTokenDecimals, detectCairoOFTType,
    readOutboundRateLimit, readInboundRateLimit, setCairoRateLimit,
  };
}
