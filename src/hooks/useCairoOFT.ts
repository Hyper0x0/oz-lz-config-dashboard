import { useCallback } from 'react';
import { RpcProvider, CallData, Contract } from 'starknet';
import type { WalletAccount } from 'starknet';
import type { TxState, PeerEntry } from '@/types';
import { decodeContractError, extractErrorDetails } from '@/utils/decodeError';
import StarknetOFTABI from '@/abis/svm/OFT.json';
import StarknetOFTAdapterABI from '@/abis/svm/OFTAdapter.json';

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

/** Read the peer bytes32 stored for a given EID from a Cairo OFT, returned as a hex string. */
async function readCairoPeer(cairoOftAddr: string, eid: number, rpc: string): Promise<string | null> {
  try {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const result = await provider.callContract({
      contractAddress: cairoOftAddr,
      entrypoint: 'get_peer',
      calldata: CallData.compile([eid]),
    });
    // result is [low, high] for the Bytes32 value
    const low  = BigInt(result[0]);
    const high = BigInt(result[1]);
    const value = (high << BigInt(128)) | low;
    if (value === 0n) return null;
    return '0x' + value.toString(16).padStart(64, '0');
  } catch {
    return null;
  }
}

export interface CairoOFTState {
  peer: string | null;   // bytes32 hex — the EVM Bridge address stored on-chain
  loading: boolean;
  error: string | null;
}

export interface CairoOFTOps {
  readPeer: (cairoOftAddr: string, evmEid: number, rpc: string) => Promise<CairoOFTState>;
  /** Query get_peer for every entry in eidList in parallel. Returns PeerEntry[]. */
  readAllPeers: (cairoOftAddr: string, eidList: Array<{ eid: number; name: string }>, rpc: string) => Promise<PeerEntry[]>;
  /** Read enforced options from the Cairo OFT. Returns true if non-empty ByteArray is set. */
  /** Returns the enforced options as a hex string (LZ options format), or null if not set. */
  readEnforcedOptions: (cairoOftAddr: string, evmEid: number, rpc: string) => Promise<string | null>;
  setPeer: (cairoOftAddr: string, evmEid: number, evmBridgeAddr: string) => Promise<TxState>;
  /** Quote the LZ fee for a Cairo OFT send */
  cairoQuoteSend: (cairoOftAddr: string, dstEid: number, toEvmAddr: string, amountLD: bigint, minAmountLD: bigint, rpc: string) => Promise<{ nativeFee: bigint; lzTokenFee: bigint }>;
  /** Execute a cross-chain send from Cairo OFT */
  cairoSend: (cairoOftAddr: string, dstEid: number, toEvmAddr: string, amountLD: bigint, minAmountLD: bigint, fee: { nativeFee: bigint; lzTokenFee: bigint }, underlyingTokenAddr?: string, feeTokenAddr?: string) => Promise<TxState>;
  /** Read OFT balance for a Starknet account */
  cairoBalance: (cairoOftAddr: string, owner: string, rpc: string) => Promise<bigint>;
  readCairoTokenInfo: (addr: string, rpc: string) => Promise<{ name: string; symbol: string }>;
  detectCairoOFTType: (addr: string, rpc: string) => Promise<{ type: 'adapter' | 'oft'; tokenAddr: string | null }>;
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

  const readAllPeers = useCallback(async (cairoOftAddr: string, eidList: Array<{ eid: number; name: string }>, rpc: string): Promise<PeerEntry[]> => {
    const settled = await Promise.allSettled(eidList.map((item) => readCairoPeer(cairoOftAddr, item.eid, rpc)));
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
        contractAddress: cairoOftAddr,
        entrypoint: 'get_enforced_options',
        calldata: CallData.compile([evmEid, 1 /* MSG_TYPE_SEND */]),
      });
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
        contractAddress: cairoOftAddr,
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
          contractAddress: cairoOftAddr,
          entrypoint: 'quote_send',
          calldata,
        });
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

  const cairoSend = useCallback(async (
    cairoOftAddr: string,
    dstEid: number,
    toEvmAddr: string,
    amountLD: bigint,
    minAmountLD: bigint,
    fee: { nativeFee: bigint; lzTokenFee: bigint },
    /** If this is an OFT Adapter, pass the underlying ERC20 token address to batch approve + send. */
    underlyingTokenAddr?: string,
    /** Fee token address (ETH or STRK on Starknet). If provided, approve is bundled. */
    feeTokenAddr?: string,
  ): Promise<TxState> => {
    if (!account) return { status: 'error', message: 'Starknet wallet not connected' };
    try {
      const [toLow, toHigh] = evmAddrToBytes32Calldata(toEvmAddr);
      const emptyBA = ['0', '0x0', '0']; // empty ByteArray

      const sendCall = {
        contractAddress: cairoOftAddr,
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
      };

      // Build multicall: fee approval + optional token approval + send
      const calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }> = [];

      // 1. Approve fee token (ETH/STRK) for the OFT to pay LZ messaging fee
      if (feeTokenAddr && fee.nativeFee > 0n) {
        calls.push({
          contractAddress: feeTokenAddr,
          entrypoint: 'approve',
          calldata: [cairoOftAddr, ...encodeU256(fee.nativeFee)],
        });
      }

      // 2. Approve underlying ERC20 token for adapter lockbox
      if (underlyingTokenAddr) {
        calls.push({
          contractAddress: underlyingTokenAddr,
          entrypoint: 'approve',
          calldata: [cairoOftAddr, ...encodeU256(amountLD)],
        });
      }

      // 3. Send
      calls.push(sendCall);

      const response = await account.execute(calls);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: decodeContractError(e), details: extractErrorDetails(e, { contractAddr: cairoOftAddr, functionName: 'send (Cairo OFT)', functionCall: `send({ dstEid: ${dstEid}, to: ${toEvmAddr}, amountLD: ${amountLD}, minAmountLD: ${minAmountLD} }, { nativeFee: ${fee.nativeFee}, lzTokenFee: ${fee.lzTokenFee} })` }) };
    }
  }, [account]);

  const cairoBalance = useCallback(async (cairoOftAddr: string, owner: string, rpc: string): Promise<bigint> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const contract = new Contract(StarknetOFTABI, cairoOftAddr, provider);
    const result = await contract.balance_of(owner);
    const low = BigInt(result.low ?? result[0] ?? '0');
    const high = BigInt(result.high ?? result[1] ?? '0');
    return low + (high << BigInt(128));
  }, []);

  /** Read name + symbol from a Starknet contract (OFT or ERC20). Handles both felt252 and ByteArray returns. */
  const readCairoTokenInfo = useCallback(async (addr: string, rpc: string): Promise<{ name: string; symbol: string }> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    const fallback = { name: addr.slice(0, 10) + '…', symbol: '' };
    try {
      const [nameResult, symbolResult] = await Promise.allSettled([
        provider.callContract({ contractAddress: addr, entrypoint: 'name', calldata: [] }),
        provider.callContract({ contractAddress: addr, entrypoint: 'symbol', calldata: [] }),
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

  /**
   * Detect whether a Starknet OFT contract is an Adapter (has token()) or a native OFT.
   * Returns the underlying token address if adapter, null if OFT.
   */
  const detectCairoOFTType = useCallback(async (addr: string, rpc: string): Promise<{ type: 'adapter' | 'oft'; tokenAddr: string | null }> => {
    const provider = new RpcProvider({ nodeUrl: rpc });
    try {
      const result = await provider.callContract({ contractAddress: addr, entrypoint: 'token', calldata: [] });
      const tokenAddr = result[0];
      if (!tokenAddr || tokenAddr === '0x0') return { type: 'oft', tokenAddr: null };
      // If token() returns the contract's own address, it's an OFT; otherwise it's an adapter
      const selfNorm = BigInt(addr);
      const tokenNorm = BigInt(tokenAddr);
      if (selfNorm === tokenNorm) return { type: 'oft', tokenAddr: null };
      return { type: 'adapter', tokenAddr };
    } catch {
      // token() not found → it's a plain OFT without the adapter interface
      return { type: 'oft', tokenAddr: null };
    }
  }, []);

  return { readPeer, readAllPeers, readEnforcedOptions, setPeer, cairoQuoteSend, cairoSend, cairoBalance, readCairoTokenInfo, detectCairoOFTType };
}
