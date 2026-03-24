import { keccak256, AbiCoder } from 'ethers';
/**
 * Reproduces TimelockController.hashOperation on-chain:
 *   keccak256(abi.encode(target, value, data, predecessor, salt))
 */
export function hashOperation(target, value, data, predecessor, salt) {
    return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'bytes', 'bytes32', 'bytes32'], [target, value, data, predecessor, salt]));
}
/**
 * @param seconds - delay in seconds
 * @returns human-readable string like "2d 4h 30m"
 */
export function formatDelay(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0)
        parts.push(`${d}d`);
    if (h > 0)
        parts.push(`${h}h`);
    if (m > 0)
        parts.push(`${m}m`);
    return parts.length > 0 ? parts.join(' ') : '< 1m';
}
/**
 * @param eta - Unix timestamp (seconds) when the operation becomes ready
 * @returns human-readable countdown or "Ready"
 */
export function formatCountdown(eta) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = eta - now;
    if (remaining <= 0)
        return 'Ready';
    return `Ready in ${formatDelay(remaining)}`;
}
/** Maps TimelockController.OperationState uint8 to a readable label. */
export function operationStateLabel(state) {
    switch (state) {
        case 0: return 'Unset';
        case 1: return 'Waiting';
        case 2: return 'Ready';
        case 3: return 'Done';
        default: return 'Unset';
    }
}
/** Generates a random bytes32 salt. */
export function randomSalt() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
