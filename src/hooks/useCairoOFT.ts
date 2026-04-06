import { useCallback } from 'react';
import { RpcProvider, CallData, Contract } from 'starknet';
import type { WalletAccount } from 'starknet';
import type { TxState, PeerEntry } from '@/types';
import StarknetOFTABI from '@/abis/svm/OFT.json';

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
  readEnforcedOptions: (cairoOftAddr: string, evmEid: number, rpc: string) => Promise<boolean>;
  setPeer: (cairoOftAddr: string, evmEid: number, evmBridgeAddr: string) => Promise<TxState>;
  /** Quote the LZ fee for a Cairo OFT send */
  cairoQuoteSend: (cairoOftAddr: string, dstEid: number, toEvmAddr: string, amountLD: bigint, minAmountLD: bigint, rpc: string) => Promise<{ nativeFee: bigint; lzTokenFee: bigint }>;
  /** Execute a cross-chain send from Cairo OFT */
  cairoSend: (cairoOftAddr: string, dstEid: number, toEvmAddr: string, amountLD: bigint, minAmountLD: bigint, fee: { nativeFee: bigint; lzTokenFee: bigint }) => Promise<TxState>;
  /** Read OFT balance for a Starknet account */
  cairoBalance: (cairoOftAddr: string, owner: string, rpc: string) => Promise<bigint>;
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

  const readEnforcedOptions = useCallback(async (cairoOftAddr: string, evmEid: number, rpc: string): Promise<boolean> => {
    try {
      const provider = new RpcProvider({ nodeUrl: rpc });
      // Use raw callContract to avoid starknet.js ByteArray parsing issues
      const result = await provider.callContract({
        contractAddress: cairoOftAddr,
        entrypoint: 'get_enforced_options',
        calldata: CallData.compile([evmEid, 1 /* MSG_TYPE_SEND */]),
      });
      // Raw result for ByteArray: [data_len, ...data_felts, pending_word, pending_word_len]
      if (!result || result.length === 0) return false;
      const dataLen = Number(result[0]);
      const pendingWord = result[1 + dataLen];
      const pendingWordLen = Number(result[2 + dataLen] ?? 0);
      return dataLen > 0 || (pendingWordLen > 0 && BigInt(pendingWord) !== 0n);
    } catch {
      return false;
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
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
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
    const provider = new RpcProvider({ nodeUrl: rpc });
    const [toLow, toHigh] = evmAddrToBytes32Calldata(toEvmAddr);
    const emptyBA = ['0', '0x0', '0']; // empty ByteArray: data_len=0, pending_word=0, pending_word_len=0
    // Raw calldata to avoid starknet.js ByteArray serialization issues
    const result = await provider.callContract({
      contractAddress: cairoOftAddr,
      entrypoint: 'quote_send',
      calldata: [
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
      ],
    });
    // MessagingFee = { native_fee: u256, lz_token_fee: u256 }
    // Result: [native_low, native_high, lz_low, lz_high]
    const nativeFee = (BigInt(result[1]) << 128n) | BigInt(result[0]);
    const lzTokenFee = (BigInt(result[3]) << 128n) | BigInt(result[2]);
    return { nativeFee, lzTokenFee };
  }, []);

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
      // Raw calldata to avoid starknet.js ByteArray serialization issues
      const response = await account.execute([{
        contractAddress: cairoOftAddr,
        entrypoint: 'send',
        calldata: [
          // SendParam
          dstEid.toString(),                   // dst_eid
          toLow, toHigh,                       // to (Bytes32)
          ...encodeU256(amountLD),             // amount_ld
          ...encodeU256(minAmountLD),          // min_amount_ld
          ...emptyBA,                          // extra_options
          ...emptyBA,                          // compose_msg
          ...emptyBA,                          // oft_cmd
          // MessagingFee
          ...encodeU256(fee.nativeFee),        // native_fee
          ...encodeU256(fee.lzTokenFee),       // lz_token_fee
          // refund_address
          account.address,
        ],
      }]);
      await account.waitForTransaction(response.transaction_hash);
      return { status: 'success', hash: response.transaction_hash };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
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

  return { readPeer, readAllPeers, readEnforcedOptions, setPeer, cairoQuoteSend, cairoSend, cairoBalance };
}
