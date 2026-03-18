/**
 * EVM address (20 bytes) → felt252 bigint.
 * Safe — EVM addresses are 160 bits, well within the 252-bit felt range.
 */
export function evmToFelt(evmAddr: string): bigint {
  return BigInt(evmAddr);
}

/**
 * felt252 (bigint) → bytes32 hex string for EVM setPeer.
 */
export function feltToBytes32(felt: bigint): string {
  return '0x' + felt.toString(16).padStart(64, '0');
}

/**
 * Starknet contract address string → bigint felt252.
 */
export function starknetAddrToFelt(addr: string): bigint {
  return BigInt(addr);
}

/**
 * bytes32 hex string → bigint (for reading EVM peer config).
 */
export function bytes32ToBigInt(bytes32: string): bigint {
  return BigInt(bytes32);
}

/**
 * Truncates a bytes32 peer to a Starknet-style hex address (31 bytes).
 */
export function bytes32ToStarknetAddr(bytes32: string): string {
  const n = BigInt(bytes32);
  return '0x' + n.toString(16).padStart(63, '0');
}
