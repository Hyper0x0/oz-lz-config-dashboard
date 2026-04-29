/**
 * Decode contract revert errors into human-readable messages.
 * Handles both Starknet (felt-encoded strings) and EVM (ethers error wrapping).
 */

/** Try to decode a hex felt as a short ASCII string (Cairo short-string encoding). */
function feltHexToString(hex: string): string | null {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length > 62) return null;
  // Must be valid hex pairs
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
  const padded = clean.length % 2 === 1 ? '0' + clean : clean;
  const bytes = [];
  for (let i = 0; i < padded.length; i += 2) {
    const b = parseInt(padded.slice(i, i + 2), 16);
    if (b < 0x20 || b > 0x7e) return null; // not printable ASCII
    bytes.push(b);
  }
  return String.fromCharCode(...bytes);
}

/** Extract and decode Starknet revert errors from a JSON-RPC error or starknet.js error. */
function decodeStarknetError(msg: string): string | null {
  // Pattern: 0x<hex> ('decoded') — already decoded by some RPCs (Alchemy)
  const alreadyDecoded = msg.match(/0x[0-9a-fA-F]+\s+\('([^']+)'\)/);
  if (alreadyDecoded) return alreadyDecoded[1];

  // Pattern: Failure reason:\n0x<hex>\n or ending with 0x<hex>.
  const failureHex = msg.match(/(?:Failure reason:|revert_error[^0]*)(0x[0-9a-fA-F]+)/);
  if (failureHex) {
    const decoded = feltHexToString(failureHex[1]);
    if (decoded) return decoded;
  }

  // Pattern: felt hex at end of "Contract error" messages
  const trailingHex = msg.match(/\b(0x[0-9a-fA-F]{4,62})\s*\.?\s*$/);
  if (trailingHex) {
    const decoded = feltHexToString(trailingHex[1]);
    if (decoded) return decoded;
  }

  return null;
}

/** Extract EVM revert reason from ethers error messages. */
function decodeEvmError(msg: string): string | null {
  // ethers v6: 'execution reverted: "Reason string"'
  const quoted = msg.match(/execution reverted:\s*"([^"]+)"/i);
  if (quoted) return quoted[1];

  // ethers v6: 'execution reverted (unknown custom error)'
  const customErr = msg.match(/execution reverted\s*\(([^)]+)\)/i);
  if (customErr) return `Reverted: ${customErr[1]}`;

  // Generic revert
  if (/reverted/i.test(msg) && msg.length < 200) return msg;

  return null;
}

/**
 * Detect Starknet RPC-level errors (bad params, missing method, transport) that
 * never reached the contract. These must NOT be reported as contract reverts.
 */
function decodeStarknetRpcError(raw: string): string | null {
  // unknown block tag — provider doesn't accept 'pending' (or whatever tag we sent)
  const unknownTag = raw.match(/unknown block tag '([^']+)'/i);
  if (unknownTag) {
    return `Starknet RPC rejected block tag '${unknownTag[1]}'. Switch to an RPC that supports it (or update Settings).`;
  }
  // -32602 Invalid Params (any other shape)
  if (/-32602|invalid params/i.test(raw)) {
    const detail = raw.match(/-32602:\s*([^\n"]+)/i)?.[1]?.trim() ?? raw.match(/Invalid Params:\s*"?([^"\n]+)"?/i)?.[1]?.trim();
    return `Starknet RPC rejected the call params${detail ? `: ${detail}` : ''}. This is an RPC config issue, not a contract revert.`;
  }
  // -32601 Method Not Found
  if (/-32601|method not found/i.test(raw)) {
    return `Starknet RPC method not found. The endpoint may be on an older spec — try a different RPC in Settings.`;
  }
  // Transport: 401/403/429/5xx and "fetch failed" / network errors
  if (/\b(401|403)\b/.test(raw)) return 'Starknet RPC unauthorized (401/403). Check the API key in Settings.';
  if (/\b429\b|rate ?limit/i.test(raw)) return 'Starknet RPC rate-limited (429). Try again or use a different RPC.';
  if (/\b5\d\d\b|bad gateway|gateway timeout|service unavailable/i.test(raw)) {
    return 'Starknet RPC is down or returning 5xx. Try another RPC in Settings.';
  }
  if (/fetch failed|networkerror|enotfound|econnrefused|econnreset/i.test(raw)) {
    return 'Starknet RPC unreachable (network error). Check connectivity or RPC URL.';
  }
  return null;
}

/**
 * Decode a raw error into a user-friendly message.
 * Falls back to truncated original if no specific decoding applies.
 */
export function decodeContractError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // RPC-level errors first — these never hit the contract, so don't say "reverted"
  const rpcDecoded = decodeStarknetRpcError(raw);
  if (rpcDecoded) {
    return rpcDecoded;
  }

  // Try Starknet felt decoding
  const starkDecoded = decodeStarknetError(raw);
  if (starkDecoded) {
    return `Contract reverted: "${starkDecoded}"`;
  }

  // Try EVM revert reason
  const evmDecoded = decodeEvmError(raw);
  if (evmDecoded) {
    return evmDecoded;
  }

  // Known starknet.js wrapper — strip the verbose RPC params
  if (raw.includes('starknet_call with params')) {
    const codeMatch = raw.match(/(\d+):\s*Contract error/);
    const code = codeMatch ? ` (code ${codeMatch[1]})` : '';
    return `Starknet contract call failed${code}. The contract reverted — check that the pathway is fully configured (peers, DVNs, libraries, enforced options).`;
  }

  // Fallback: truncate
  return raw.length > 300 ? raw.slice(0, 300) + '…' : raw;
}

/**
 * Extract structured error details from an ethers or starknet error.
 * Used to build the `details` field on TxState errors.
 */
export function extractErrorDetails(
  err: unknown,
  meta: { contractAddr?: string; functionName?: string; functionCall?: string },
): import('@/types').TxErrorDetails {
  const raw = err instanceof Error ? err.message : String(err);
  const details: import('@/types').TxErrorDetails = {
    contractAddr: meta.contractAddr,
    functionName: meta.functionName,
    functionCall: meta.functionCall,
    rawError: raw.length > 2000 ? raw.slice(0, 2000) + '…' : raw,
  };

  // ethers v6: error.transaction?.data contains the encoded calldata
  const anyErr = err as Record<string, unknown>;
  const tx = anyErr.transaction as Record<string, unknown> | undefined;
  if (tx?.data && typeof tx.data === 'string') {
    details.callData = tx.data;
  }
  // ethers v6 sometimes nests inside info.error.transaction
  const info = anyErr.info as Record<string, unknown> | undefined;
  const infoErr = info?.error as Record<string, unknown> | undefined;
  const infoTx = infoErr?.transaction as Record<string, unknown> | undefined;
  if (!details.callData && infoTx?.data && typeof infoTx.data === 'string') {
    details.callData = infoTx.data;
  }
  // Starknet: error may carry calldata in the request body
  if (!details.callData && typeof raw === 'string' && raw.includes('calldata')) {
    const match = raw.match(/"calldata"\s*:\s*\[([^\]]+)\]/);
    if (match) details.callData = `[${match[1]}]`;
  }

  return details;
}
