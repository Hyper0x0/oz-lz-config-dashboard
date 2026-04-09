import { Interface } from 'ethers';
import type { TxState, TxErrorDetails } from '@/types';

function downloadJson(data: Record<string, unknown>, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Try to extract the 4-byte function selector + tx fields from an ethers error message string. */
function parseErrorTx(msg: string): { selector: string | null; txData: string | null; from: string | null; to: string | null } {
  const txDataMatch = msg.match(/"data"\s*:\s*"(0x[0-9a-fA-F]+)"/);
  const txData = txDataMatch?.[1] ?? null;
  const selector = txData && txData.length >= 10 ? txData.slice(0, 10) : null;
  const fromMatch = msg.match(/"from"\s*:\s*"(0x[0-9a-fA-F]+)"/);
  const toMatch = msg.match(/"to"\s*:\s*"(0x[0-9a-fA-F]+)"/);
  return { selector, txData, from: fromMatch?.[1] ?? null, to: toMatch?.[1] ?? null };
}

/** Well-known revert error selectors for LZ / OZ contracts. */
const KNOWN_ERRORS: Record<string, string> = {
  '0xc4c52593': 'LZ_Unauthorized — caller is not the OApp owner or delegate. Set delegate first.',
  '0x391daaa4': 'LZ_UnsupportedEid — the remote EID is not supported by this endpoint or library.',
  '0x82f0dc39': 'LZ_InvalidSendLibrary — the library address is not registered as a valid send library.',
  '0x6c1ccdb5': 'LZ_DefaultSendLibUnavailable — no default send library configured for this EID.',
  '0x82b42900': 'Unauthorized — caller lacks required permissions.',
  '0x84611595': 'OnlyRegisteredLibrary — library must be registered on the endpoint first.',
  '0x118cdaa7': 'OwnableUnauthorizedAccount — caller is not the contract owner.',
  '0xd009138a': 'DVN_EidNotSupported — the configured DVN does not support this remote EID/chain. Use a DVN that covers this pathway.',
  '0xf6ff4fb7': 'NoPeer — no peer address set for this remote EID. Set peers before sending.',
};

/** Try to extract the revert selector from an error message and decode it. */
function decodeRevert(msg: string): string | null {
  const match = msg.match(/data="(0x[0-9a-fA-F]{8})"/);
  return match ? KNOWN_ERRORS[match[1]] ?? null : null;
}

/** Well-known function signatures for LZ / OZ contracts. */
const KNOWN_FUNCTIONS: string[] = [
  'function setDelegate(address _delegate)',
  'function setPeer(uint32 _eid, bytes32 _peer)',
  'function setEnforcedOptions((uint32 eid, uint16 msgType, bytes options)[] _enforcedOptions)',
  'function setRateLimits((uint32 dstEid, uint256 limit, uint256 window)[] _rateLimitConfigs)',
  'function grantRole(bytes32 role, address account)',
  'function revokeRole(bytes32 role, address account)',
  'function renounceRole(bytes32 role, address callerConfirmation)',
  'function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable',
  'function approve(address spender, uint256 value)',
  'function setSendLibrary(address _oapp, uint32 _eid, address _newLib)',
  'function setReceiveLibrary(address _oapp, uint32 _eid, address _newLib, uint256 _gracePeriod)',
  'function setConfig(address _oapp, address _lib, (uint32 eid, uint32 configType, bytes config)[] _params)',
];

const KNOWN_IFACE = new Interface(KNOWN_FUNCTIONS);

/** Decode calldata into { method, params } using known ABI fragments. Returns null if unknown. */
function decodeCalldata(data: string): { method: string; params: Record<string, string> } | null {
  try {
    const decoded = KNOWN_IFACE.parseTransaction({ data });
    if (!decoded) return null;
    const params: Record<string, string> = {};
    for (const [i, input] of decoded.fragment.inputs.entries()) {
      const name = input.name || `arg${i}`;
      const val = decoded.args[i];
      params[name] = formatParam(val);
    }
    return { method: decoded.name, params };
  } catch {
    return null;
  }
}

/** Recursively format a decoded param value to a readable string. */
function formatParam(val: unknown): string {
  if (typeof val === 'bigint') return val.toString();
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    // ethers Result objects have named keys — try to build an object
    // ethers Result objects have a toObject() method for named fields
    const asAny = val as unknown as { toObject?: () => Record<string, unknown> };
    if (typeof asAny.toObject === 'function') {
      try {
        const obj = asAny.toObject();
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) out[k] = formatParam(v);
        return JSON.stringify(out);
      } catch { /* fall through */ }
    }
    return '[' + val.map(formatParam).join(', ') + ']';
  }
  if (val && typeof val === 'object') {
    if (typeof (val as Record<string, unknown>).toObject === 'function') {
      try {
        const obj = (val as { toObject: () => Record<string, unknown> }).toObject();
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) out[k] = formatParam(v);
        return JSON.stringify(out);
      } catch { /* fall through */ }
    }
    return String(val);
  }
  return String(val);
}

function exportError(message: string, details?: TxErrorDetails): void {
  const parsed = parseErrorTx(details?.rawError ?? message);
  const callData = details?.callData ?? parsed.txData ?? null;

  // Decode calldata into human-readable params
  let decoded: { method: string; params: Record<string, string> } | null = null;
  if (callData && callData.length >= 10) {
    decoded = decodeCalldata(callData);
  }

  // Also try to decode revert data if present
  const revertDataMatch = (details?.rawError ?? message).match(/data="(0x[0-9a-fA-F]+)"/);
  const revertSelector = revertDataMatch?.[1] ?? null;

  const revertDecoded = revertSelector ? KNOWN_ERRORS[revertSelector] ?? null : null;

  downloadJson({
    timestamp: new Date().toISOString(),
    error: message,
    method: decoded?.method ?? details?.functionCall ?? details?.functionName ?? null,
    decodedParams: decoded?.params ?? null,
    selector: callData?.slice(0, 10) ?? null,
    revertData: revertSelector,
    revertReason: revertDecoded,
    contractAddr: details?.contractAddr ?? parsed.to ?? null,
    from: parsed.from ?? null,
    callData,
    rawError: details?.rawError ?? null,
  }, `tx-error-${Date.now()}.json`);
}

interface Props {
  state: TxState;
  /** Base URL for block explorer (e.g. "https://sepolia.arbiscan.io/tx/"). Hash is appended. */
  explorerUrl?: string;
  /** Show LayerZero Scan link (only for cross-chain send transactions). */
  showLzScan?: boolean;
}

export function TxStatus({ state, explorerUrl, showLzScan }: Props): JSX.Element | null {
  if (state.status === 'idle') return null;

  if (state.status === 'pending') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13, color: 'var(--accent)' }}>
        <span className="animate-pulse">⏳</span> Transaction pending…
      </div>
    );
  }

  if (state.status === 'success') {
    const url = explorerUrl ? `${explorerUrl}${state.hash}` : null;
    const lzScanUrl = `https://layerzeroscan.com/tx/${state.hash}`;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--secondary)' }}>✓ Confirmed</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            View on Explorer ↗
          </a>
        )}
        {showLzScan && (
          <a href={lzScanUrl} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            LayerZero Scan ↗
          </a>
        )}
      </div>
    );
  }

  // error
  const revertHint = decodeRevert(state.message);
  return (
    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--error)', lineHeight: 1.5 }}>
      {revertHint && (
        <div style={{ marginBottom: 4, padding: '4px 8px', background: 'var(--error-container, rgba(255,0,0,0.08))', borderRadius: 4, fontSize: 12 }}>
          {revertHint}
        </div>
      )}
      <div>✗ {state.message.length > 200 ? state.message.slice(0, 200) + '…' : state.message}</div>
      <button
        onClick={() => exportError(state.message, state.details)}
        style={{ marginTop: 4, fontSize: 11, color: 'var(--error)', background: 'none', border: '1px solid currentColor', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', opacity: 0.8 }}
      >
        Export error details
      </button>
    </div>
  );
}

export { downloadJson };
