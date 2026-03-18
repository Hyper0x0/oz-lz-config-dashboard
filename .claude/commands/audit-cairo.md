# Audit — Cairo

> Load alongside `.claude/commands/audit-report.md` and `.claude/dev/cairo.md`.

---

## Cairo — Security Checklist

### Access Control
- [ ] OZ `Ownable` or `AccessControl` component used — no custom roll-your-own
- [ ] Every privileged function calls `assert_only_owner()` or role check
- [ ] Ownership transfer path exists and is tested

### Arithmetic
- [ ] No `felt252` used for financial math (wraps silently at prime boundary)
- [ ] `u256`/`u128` used for all amounts and balances
- [ ] Arithmetic in loops verified for overflow (u256/u128 panic, but verify logic)
- [ ] Division results documented (Cairo integer division is not standard)

### Steps / Gas
- [ ] No unbounded loops over user-controlled data
- [ ] All loops have explicit max bounds (`MAX_BATCH`)
- [ ] No deep recursion over large inputs
- [ ] Storage reads cached in local vars inside loops

### Storage
- [ ] No storage collision between components (`#[substorage(v0)]` used)
- [ ] No mapping iteration attempted
- [ ] LegacyMap keys designed to avoid collision

### Cross-Contract
- [ ] Cross-contract calls that mutate state guarded against reentrancy
- [ ] OZ `ReentrancyGuard` component used on sensitive functions
- [ ] L1↔L2 bridge address validation at boundary

### Other
- [ ] Events emitted for all state changes
- [ ] Interface defined separately from implementation
- [ ] Caracal output reviewed — no unaddressed findings

--- 