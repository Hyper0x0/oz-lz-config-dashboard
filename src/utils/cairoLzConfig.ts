/**
 * Encoding utilities for Starknet LayerZero config structs.
 *
 * Starknet's `set_send_configs` / `set_receive_configs` take a `SetConfigParam`
 * where `config` is `Array<felt252>` — Cairo's Serde-serialised struct layout.
 *
 * UlnConfig field order (must match contract struct exactly):
 *   confirmations (u64), has_confirmations (bool),
 *   required_dvns.len + items (Array<ContractAddress>), has_required_dvns (bool),
 *   optional_dvns.len + items (Array<ContractAddress>),
 *   optional_dvn_threshold (u8), has_optional_dvns (bool)
 *
 * ExecutorConfig field order:
 *   max_message_size (u32), executor (ContractAddress)
 */

export const CONFIG_TYPE_EXECUTOR = 1;
export const CONFIG_TYPE_ULN = 2;

function toFelt(value: bigint | number | string): string {
  const n = typeof value === 'string' ? BigInt(value) : BigInt(value);
  return '0x' + n.toString(16);
}

export interface UlnConfigParams {
  confirmations: number;
  requiredDvns: string[];          // sorted ascending
  optionalDvns?: string[];
  optionalDvnThreshold?: number;
}

export interface ExecutorConfigParams {
  maxMessageSize: number;
  executor: string;
}

/**
 * Encode a UlnConfig as a felt252[] array.
 * DVN addresses must be sorted ascending (ascending by hex value).
 */
export function encodeUlnConfig(params: UlnConfigParams): string[] {
  const {
    confirmations,
    requiredDvns,
    optionalDvns = [],
    optionalDvnThreshold = 0,
  } = params;

  const hasRequired = requiredDvns.length > 0;
  const hasOptional = optionalDvns.length > 0 || optionalDvnThreshold > 0;

  return [
    toFelt(confirmations),                        // confirmations: u64
    hasRequired || confirmations > 0 ? '0x1' : '0x0', // has_confirmations
    toFelt(requiredDvns.length),                  // required_dvns.len
    ...requiredDvns.map(toFelt),
    hasRequired ? '0x1' : '0x0',                 // has_required_dvns
    toFelt(optionalDvns.length),                  // optional_dvns.len
    ...optionalDvns.map(toFelt),
    toFelt(optionalDvnThreshold),                 // optional_dvn_threshold: u8
    hasOptional ? '0x1' : '0x0',                 // has_optional_dvns
  ];
}

/**
 * Encode an ExecutorConfig as a felt252[] array.
 */
export function encodeExecutorConfig(params: ExecutorConfigParams): string[] {
  return [
    toFelt(params.maxMessageSize),
    toFelt(params.executor),
  ];
}

/** Sort DVN addresses ascending (required by the ULN contract). */
export function sortDvns(addresses: string[]): string[] {
  return [...addresses].sort((a, b) => {
    const diff = BigInt(a) - BigInt(b);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  });
}
