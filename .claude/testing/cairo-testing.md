# Cairo Testing Standards

> Load when writing or reviewing Cairo/Starknet tests.
> Read alongside `.claude/dev/cairo.md` for naming and code style rules.
> Always use `snforge` — never `scarb cairo-test`.

---


## Test Types

### Unit Tests
- One function per behavior — use `_deploy_*` helper to avoid repetition
- Test both happy path and all revert conditions

### Fuzz Tests
```cairo
#[test]
fn test_deposit_fuzz(amount: u256) {
    // snforge generates random u256 values
    if amount == 0 { return; }
    let vault = _deploy_vault(OWNER());
    start_cheat_caller_address(vault.contract_address, USER());
    vault.deposit(amount);
    assert(vault.get_balance(USER()) == amount, 'wrong balance');
}
```

### Fork Tests
```cairo
// snforge supports forking via scarb config or CLI
// snforge test --fork-url $MAINNET_RPC --fork-block-number 100000
#[test]
#[fork("MAINNET")]
fn test_against_mainnet_state() {
    // interact with deployed contracts
}
```

---

## Coverage Target

- ≥ 90% line coverage
- 100% on all fund-touching and access-control paths