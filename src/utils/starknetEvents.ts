import { RpcProvider, hash } from 'starknet';

export interface StarknetEvent {
  from_address: string;
  keys: string[];
  data: string[];
  block_number: number;
  transaction_hash: string;
}

interface EventFilter {
  from_block?: { block_number: number } | 'latest';
  to_block?: { block_number: number } | 'latest';
  address?: string;
  keys?: string[][];
  chunk_size: number;
  continuation_token?: string;
}

/**
 * Fetch all Starknet events from `address` matching any of the given event names
 * at key position 0, paginating via `continuation_token`. Stops after `maxEvents`
 * to avoid runaway scans on misconfigured contracts.
 */
export async function getAllStarknetEvents(
  rpc: string,
  address: string,
  eventNames: string[],
  fromBlock?: number,
  toBlock?: number,
  opts: { chunkSize?: number; maxEvents?: number; onProgress?: (count: number) => void } = {},
): Promise<StarknetEvent[]> {
  const { chunkSize = 1000, maxEvents = 50000, onProgress } = opts;
  const provider = new RpcProvider({ nodeUrl: rpc });
  const keys = eventNames.map((n) => hash.getSelectorFromName(n));
  const all: StarknetEvent[] = [];
  let continuation_token: string | undefined;

  do {
    const filter: EventFilter = {
      address,
      keys: [keys],
      chunk_size: chunkSize,
    };
    if (fromBlock !== undefined) filter.from_block = { block_number: fromBlock };
    if (toBlock !== undefined) filter.to_block = { block_number: toBlock };
    if (continuation_token) filter.continuation_token = continuation_token;

    // starknet.js types the filter loosely; cast for the RPC call.
    const result = await provider.getEvents(filter as Parameters<RpcProvider['getEvents']>[0]);
    const events = result.events as unknown as StarknetEvent[];
    all.push(...events);
    onProgress?.(all.length);
    continuation_token = result.continuation_token;
    if (all.length >= maxEvents) break;
  } while (continuation_token);

  return all;
}

/** Compute the sn_keccak event-key selector for a given event name. */
export function eventKey(name: string): string {
  return hash.getSelectorFromName(name);
}
