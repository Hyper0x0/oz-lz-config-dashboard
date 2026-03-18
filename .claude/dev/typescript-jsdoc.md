# TSDoc — TypeScript

> When and how to document TypeScript code.

---

## TSDoc — TypeScript

TypeScript has types, so TSDoc is lighter than JSDoc — focus on *why*, not *what*.
Use `/** */` blocks. `@param` and `@returns` are optional when types are self-explanatory;
add them only when the tag conveys meaning the type signature cannot express.

### Public Functions
```typescript
/**
 * Converts an asset amount to vault shares using the current epoch price.
 *
 * Rounds DOWN to protect against share inflation — callers should not
 * assume the result is exact. See ERC-4626 §8.
 *
 * @param assets - Amount of underlying asset in wei
 * @returns Shares equivalent, rounded down
 */
function convertToShares(assets: bigint): bigint { ... }
```

### When `@param` / `@returns` adds value
```typescript
// ✅ Type alone does not explain the constraint
/**
 * @param windowMs - Must be >= 1000. Values below 1s create TWAP manipulation risk.
 */
function setTwapWindow(windowMs: number): void { ... }

// ❌ Type already tells the full story — skip the tags
/**
 * Returns the current block number.
 */
function getBlockNumber(): bigint { ... }
```

### Classes
```typescript
/**
 * Client for submitting and tracking vault operations.
 * Maintains a queue of pending requests and retries on transient RPC failures.
 */
class VaultClient {
  /**
   * @param rpcUrl - WebSocket or HTTP RPC endpoint
   * @param maxRetries - Max attempts before throwing. Default: 3.
   */
  constructor(rpcUrl: string, maxRetries = 3) { ... }
}
```

### Inline Comments — same five rules as Solidity/Cairo
```typescript
// Round down — bigint division truncates, intentional (ERC-4626 §8)
const shares = (assets * totalSupply) / totalAssets;

// SECURITY: validate before signing — treat as a trust boundary
const validated = DepositSchema.parse(input);
const tx = await wallet.signTransaction(validated);
```

---