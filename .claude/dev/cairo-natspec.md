# NatSpec — Cairo

> When and how to document Cairo code.
> Read alongside `.claude/dev/cairo.md`.

---

## NatSpec — Cairo

Cairo uses `///` with the same semantic tags as Solidity NatSpec.

**Mandatory on**: all `external`/`public` functions and non-obvious `internal` functions.

### Contracts / Modules
```cairo
/// @title  ERC-7540 Async Vault
/// @notice Handles the three-phase deposit lifecycle: request, approve, claim.
/// @dev    Storage uses LegacyMap — no iteration possible. Track requests externally.
#[starknet::contract]
mod AsyncVault { ... }
```

### External Functions
```cairo
/// @notice Submits a deposit request for async processing.
/// @dev    Assets transferred to escrow. Shares NOT minted here — claim phase only.
/// @param  assets   Amount of underlying asset tokens to deposit
/// @param  receiver Address that will receive shares after claim phase
fn request_deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) { ... }
```

### Internal Functions — only if non-obvious
```cairo
/// @dev Converts assets to shares using current epoch price.
///      Rounds DOWN — rounding up would allow share inflation.
fn _convert_to_shares(self: @ContractState, assets: u256) -> u256 { ... }
```

### Events and Errors
```cairo
/// @notice Emitted when a deposit request is submitted.
/// @param  account  Address that submitted the request
/// @param  amount   Requested asset amount
struct DepositRequested {
    #[key] account: ContractAddress,
    amount: u256,
}
```

---

## Inline Comments — When to Write Them

Write an inline comment **only** for one of these five reasons:

### 1. Non-obvious math or deliberate rounding
```cairo
// Round down — protects against share inflation (ERC-4626 §8)
let shares = assets * total_supply / total_assets;
```

### 2. Security decision
```cairo
// SECURITY: state updated before cross-contract call to prevent reentrancy
self.balances.write(caller, balance - amount);
token.transfer(caller, amount);
```

### 3. Workaround or non-intuitive behavior
```cairo
// felt252 cast safe here — value bounded to u32::MAX by MAX_BATCH check above
let index: felt252 = i.into();
```

### 4. Critical invariant or assumption
```cairo
// Invariant: total_assets >= sum(pending_redeems) must hold after settle()
assert(total_assets >= pending_redeem_total, 'Invariant violated');
```

### 5. External reference
```cairo
// EIP-7540 §4: shares must NOT be minted at request time
// Only minted at claim phase after epoch processing
```

---

## Anti-Patterns — Never Write These

```cairo
// ❌ Obvious — remove it
// Increment counter
counter += 1;

// ❌ Repeats the code
// Transfer tokens to user
token.transfer(user, amount);

// ❌ TODO in production — open a GitHub issue instead
// TODO: fix precision loss
// ✅ Acceptable: reference the issue
// NOTE: precision loss <1 unit per tx. Tracked in issue #142.
```

---

## Documentation Checklist (pre-PR)
- [ ] Every contract/module has `@title`, `@notice`, `@dev`
- [ ] Every `external`/`public` function has `@notice`, `@param` per parameter, `@return` if it returns
- [ ] Every non-obvious `internal` function has at least `@dev`
- [ ] Every event has `@notice` describing when it fires
- [ ] Inline comments on: math, security decisions, workarounds, invariants, external refs
- [ ] No obvious comments, no TODOs in production code