/**
 * Reproduces the byte encoding of:
 *   Options.newOptions().addExecutorLzReceiveOption(gasLimit, value)
 * from @layerzerolabs/lz-v2-utilities.
 *
 * Format (type-3 options):
 *   [0x00, 0x03]                   — options type header
 *   [0x01]                         — EXECUTOR_WORKER_ID
 *   [0x00, 0x21]                   — option byte length (33)
 *   [0x01]                         — OPTION_TYPE_LZRECEIVE
 *   [gasLimit as uint128, 16 bytes] — gas
 *   [value as uint128,   16 bytes]  — native value to forward
 */
export function buildLzReceiveOption(gasLimit: bigint, value = 0n): string {
  const EXECUTOR_WORKER_ID = 1;
  const OPTION_TYPE_LZRECEIVE = 1;
  const OPTION_LENGTH = 33; // type(1) + gas(16) + value(16)

  const buf = new Uint8Array(2 + 1 + 2 + OPTION_LENGTH);
  // type header
  buf[0] = 0x00;
  buf[1] = 0x03;
  // worker id
  buf[2] = EXECUTOR_WORKER_ID;
  // option length (big-endian uint16)
  buf[3] = 0x00;
  buf[4] = OPTION_LENGTH;
  // option type
  buf[5] = OPTION_TYPE_LZRECEIVE;
  // gas as big-endian uint128 (16 bytes)
  _writeBigIntBE(buf, gasLimit, 6, 16);
  // value as big-endian uint128 (16 bytes)
  _writeBigIntBE(buf, value, 22, 16);

  return '0x' + Buffer.from(buf).toString('hex');
}

function _writeBigIntBE(buf: Uint8Array, value: bigint, offset: number, byteLen: number): void {
  let v = value;
  for (let i = offset + byteLen - 1; i >= offset; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
}
