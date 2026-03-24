import { Options } from '@layerzerolabs/lz-v2-utilities';
/**
 * Build a type-3 lzReceive executor option.
 * Returns a hex string suitable for enforcedOptions on both EVM and Cairo OFTs.
 */
export function buildLzReceiveOption(gasLimit, value = 0n) {
    return Options.newOptions().addExecutorLzReceiveOption(gasLimit, value).toHex();
}
