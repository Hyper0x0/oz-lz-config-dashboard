import { Options } from '@layerzerolabs/lz-v2-utilities';

/**
 * Build a type-3 lzReceive executor option.
 * Returns a hex string suitable for enforcedOptions on both EVM and Cairo OFTs.
 */
export function buildLzReceiveOption(gasLimit: bigint, value = 0n): string {
  return Options.newOptions().addExecutorLzReceiveOption(gasLimit, value).toHex();
}

/**
 * Decode a type-3 enforced options hex string into human-readable fields.
 * Returns null if the format is unrecognized.
 */
export function decodeEnforcedOptions(hex: string): { gas: string; value?: string } | null {
  try {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length < 12) return null;
    // Type 3: 0003 + worker options
    if (clean.slice(0, 4) !== '0003') return null;
    const workerId = parseInt(clean.slice(4, 6), 16);
    // Worker 1 = executor, option 0x01 = lzReceive
    if (workerId !== 1) return null;
    // Length at bytes 3-4 (2 bytes big-endian)
    const dataLen = parseInt(clean.slice(8, 12), 16);
    const data = clean.slice(12, 12 + dataLen * 2);
    // Gas is the last 16 bytes (128-bit big-endian)
    const gasHex = data.slice(-32);
    const gas = BigInt('0x' + gasHex).toString();
    // If data is longer than 16 bytes + 1 byte flag, there's a native value too
    if (data.length > 34) {
      const valueHex = data.slice(2, data.length - 32);
      const value = BigInt('0x' + valueHex).toString();
      return { gas, value };
    }
    return { gas };
  } catch {
    return null;
  }
}
