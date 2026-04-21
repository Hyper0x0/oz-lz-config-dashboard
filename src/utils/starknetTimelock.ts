import { hash, CallData } from 'starknet';

export interface StarknetAbiFunction {
  type: 'function';
  name: string;
  inputs: { name: string; type: string }[];
  outputs: { type: string }[];
  state_mutability: 'view' | 'external';
}

type AbiItem = Record<string, unknown>;

function collectInterfaces(abi: unknown[]): Map<string, StarknetAbiFunction[]> {
  const map = new Map<string, StarknetAbiFunction[]>();
  for (const it of abi) {
    if (!it || typeof it !== 'object') continue;
    const item = it as AbiItem;
    if (item.type === 'interface' && typeof item.name === 'string' && Array.isArray(item.items)) {
      const fns = (item.items as AbiItem[]).filter((i) => i?.type === 'function') as unknown as StarknetAbiFunction[];
      map.set(item.name, fns);
    }
  }
  return map;
}

/** Flatten impl→interface and top-level functions, filter by state_mutability. */
export function extractFunctions(abi: unknown[], filter: 'external' | 'view' | 'all' = 'all'): StarknetAbiFunction[] {
  if (!Array.isArray(abi)) return [];
  const interfaces = collectInterfaces(abi);
  const seen = new Set<string>();
  const out: StarknetAbiFunction[] = [];
  const keep = (fn: StarknetAbiFunction): void => {
    if (filter !== 'all' && fn.state_mutability !== filter) return;
    if (seen.has(fn.name)) return;
    seen.add(fn.name);
    out.push(fn);
  };
  for (const it of abi) {
    if (!it || typeof it !== 'object') continue;
    const item = it as AbiItem;
    if (item.type === 'impl' && typeof item.interface_name === 'string') {
      for (const fn of interfaces.get(item.interface_name) ?? []) keep(fn);
    } else if (item.type === 'function') {
      keep(item as unknown as StarknetAbiFunction);
    }
  }
  return out;
}

export function selectorFromName(name: string): string {
  return hash.getSelectorFromName(name);
}

function toHex(n: bigint | string | number): string {
  return '0x' + BigInt(n).toString(16);
}

/** Encode a single argument into the felt-array accumulator, handling common Cairo types.
 *  For struct-valued args, the user must supply comma-separated felts as a power-user escape hatch. */
function encodeArg(out: string[], raw: string, type: string): void {
  const t = type.trim();
  const v = raw.trim();
  if (t === 'core::bool') {
    out.push(v === 'true' || v === '1' ? '0x1' : '0x0');
    return;
  }
  if (t === 'core::integer::u256') {
    const n = BigInt(v || '0');
    const MAX = (1n << 128n) - 1n;
    out.push(toHex(n & MAX));
    out.push(toHex(n >> 128n));
    return;
  }
  if (/^core::integer::u(8|16|32|64|128)$/.test(t) || /^core::integer::i(8|16|32|64|128)$/.test(t)) {
    out.push(toHex(v || '0'));
    return;
  }
  if (
    t === 'core::felt252' ||
    t === 'core::starknet::contract_address::ContractAddress' ||
    t.endsWith('::ContractAddress') ||
    t.endsWith('::ClassHash') ||
    t.endsWith('::EthAddress')
  ) {
    out.push(v || '0x0');
    return;
  }
  const arr = t.match(/^core::array::(Array|Span)::<(.+)>$/);
  if (arr) {
    const inner = arr[2];
    const parts = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
    out.push(toHex(parts.length));
    for (const p of parts) encodeArg(out, p, inner);
    return;
  }
  // Struct / tuple / anything else — expect comma-separated felts provided raw
  const parts = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
  for (const p of parts) out.push(p);
}

export function encodeCalldata(fn: StarknetAbiFunction, rawArgs: string[]): string[] {
  const out: string[] = [];
  fn.inputs.forEach((input, i) => encodeArg(out, rawArgs[i] ?? '', input.type));
  return out;
}

/** Argument placeholder hint for the UI. */
export function argPlaceholder(type: string): string {
  const t = type.trim();
  if (t === 'core::bool') return 'true / false';
  if (t === 'core::integer::u256') return '0';
  if (/^core::integer::u(8|16|32|64|128)$/.test(t)) return '0';
  if (t === 'core::felt252') return '0x… or decimal';
  if (t.endsWith('::ContractAddress')) return '0x…';
  if (t.startsWith('core::array::')) return 'comma,separated,values';
  return 'felts (comma-separated)';
}

// ── Decoding ─────────────────────────────────────────────────────────────────

interface DecodeCursor { felts: string[]; idx: number }

function readFelt(c: DecodeCursor): string { return c.felts[c.idx++] ?? '0x0'; }

function decodeType(c: DecodeCursor, type: string): string {
  const t = type.trim();
  if (t === 'core::bool') {
    return readFelt(c) === '0x0' ? 'false' : 'true';
  }
  if (t === 'core::integer::u256') {
    const low = BigInt(readFelt(c));
    const high = BigInt(readFelt(c));
    return ((high << 128n) | low).toString();
  }
  if (/^core::integer::u(8|16|32|64|128)$/.test(t) || /^core::integer::i(8|16|32|64|128)$/.test(t)) {
    return BigInt(readFelt(c)).toString();
  }
  if (
    t === 'core::felt252' ||
    t === 'core::starknet::contract_address::ContractAddress' ||
    t.endsWith('::ContractAddress') ||
    t.endsWith('::ClassHash') ||
    t.endsWith('::EthAddress')
  ) {
    return readFelt(c);
  }
  const arr = t.match(/^core::array::(Array|Span)::<(.+)>$/);
  if (arr) {
    const len = Number(BigInt(readFelt(c)));
    const parts: string[] = [];
    for (let i = 0; i < len; i++) parts.push(decodeType(c, arr[2]));
    return `[${parts.join(', ')}]`;
  }
  // Unknown / struct — best-effort: consume one felt
  return readFelt(c);
}

export interface DecodedStarknetCall { contract: string; fn: string; args: Record<string, string> }

/** Try to match (selector, calldata[]) against a set of Cairo ABIs and decode. */
export function decodeStarknetCall(
  selector: string,
  calldata: string[],
  abis: { name: string; abi: unknown[] }[],
): DecodedStarknetCall | null {
  for (const { name, abi } of abis) {
    const fns = extractFunctions(abi, 'all');
    for (const fn of fns) {
      if (selectorFromName(fn.name) !== selector) continue;
      try {
        const cursor: DecodeCursor = { felts: calldata, idx: 0 };
        const args: Record<string, string> = {};
        for (const input of fn.inputs) {
          args[input.name] = decodeType(cursor, input.type);
        }
        return { contract: name, fn: fn.name, args };
      } catch {
        // continue searching
      }
    }
  }
  return null;
}

/** Normalize a user-entered felt252 (decimal or 0x-hex) to a 0x-prefixed hex string. */
export function toFeltHex(s: string): string {
  const v = s.trim();
  if (!v) return '0x0';
  if (v.startsWith('0x') || v.startsWith('0X')) return v;
  return '0x' + BigInt(v).toString(16);
}

/** Build the felt-array calldata for a single starknet.js Call invocation (Call struct). */
export function compileCallStruct(target: string, selector: string, calldataFelts: string[]): string[] {
  return CallData.compile([{ to: target, selector, calldata: calldataFelts }]);
}
