# Cairo / Starknet Standards

> Read alongside `.claude/dev/cairo-natspec.md` for documentation rules.

---

## Toolchain

- **Cairo version**: defined in `Scarb.toml` — always use the version pinned there, never assume a newer one
- **Package manager**: Scarb
- **Test runner**: Always `snforge` (Starknet Foundry) — never `scarb cairo-test`
- **Static analyzer**: Caracal (Trail of Bits) — run before every PR
- **Libraries**: OpenZeppelin Contracts for Cairo

```bash
# Install
curl --proto '=https' --tlsv1.2 -sSf https://sh.starkup.dev | sh

scarb build
snforge test
snforge test -v              # verbose
snforge test <test_name>     # single test
scarb fmt
caracal detect .             # static analysis — before every PR
```

### Makefile — Wrapping Complex Commands

```makefile
# Makefile
.PHONY: test test-fork coverage caracal

test:
	snforge test

test-fork:
	snforge test --fork-url $(MAINNET_RPC_URL) $(TEST)

coverage:
	snforge test --coverage

caracal:
	caracal detect .
```

```bash
make test
make caracal
```

### Scarb.toml — Source of Truth for Versions
```toml
[package]
name = "my_contract"
version = "0.1.0"
edition = "2024_07"

[dependencies]
starknet = ">=2.13.1"
openzeppelin = { git = "https://github.com/OpenZeppelin/cairo-contracts", tag = "v0.20.0" }

[dev-dependencies]
snforge_std = "0.51.1"
assert_macros = "2.13.1"

[[target.starknet-contract]]
sierra = true

[scripts]
test = "snforge test"

[tool.scarb]
allow-prebuilt-plugins = ["snforge_std"]
```

---

## File Structure

Split by responsibility. Keep files under **300 lines** — if a file grows beyond that, split it.

```
src/
├── types.cairo        ← structs and custom types
├── errors.cairo       ← all error messages (felt252 constants)
├── constants.cairo    ← global constants (SCREAMING_SNAKE_CASE)
├── interface.cairo    ← all #[starknet::interface] traits
├── vault.cairo        ← main contract module
└── vault_lib.cairo    ← reusable pure functions (no storage)
```

**Rules:**
- Structs and errors in dedicated files — never defined inline in the module that first uses them
- If a struct or error is used in more than one module, it must live in `types.cairo` or `errors.cairo`
- Constants shared across modules go in `constants.cairo`
- All interfaces (`#[starknet::interface]` traits) in `interface.cairo` — one trait per interface
- Pure helper functions reused across modules go in a `*_lib.cairo` file (no `#[storage]`)
- Use `use` to import — `use crate::errors::NotAuthorized;`

---

## Key Differences from Solidity

| Concept | Solidity | Cairo |
|---|---|---|
| Storage | Mapping/slots | `#[storage]` struct fields |
| Integer types | `uint256`, `int256` | `u256`, `u128`, `felt252`... |
| Overflow | Built-in 0.8+ | Typed integers panic; `felt252` wraps silently |
| Events | `event EventName(...)` | `#[event]` enum + `self.emit(...)` |
| Errors | `revert CustomError()` | `assert(cond, 'msg')` or `panic` |
| Interfaces | `interface IFoo` | `#[starknet::interface] trait IFoo<T>` |
| `msg.sender` | Direct | `get_caller_address()` |
| `msg.value` | Native ETH | No native ETH — use ERC20 explicitly |
| `fallback()` | Supported | Not supported |
| Mapping iteration | Possible (with care) | Not possible — track keys externally |

---

## Security Rules

**Access Control** — use OZ `Ownable` or `AccessControl` components; never roll your own.

**`felt252` arithmetic** — wraps silently at the prime field boundary. Never use for financial math. Use `u256` or `u128` instead. `felt252` is only safe for IDs and hashes.

**Storage collisions** — components use namespaced storage (`#[substorage(v0)]`). Always explicit, never implicit.

**Integer overflow** — typed integers (`u256`, `u128`) panic by default. Verify arithmetic in loops and financial logic.

**Reentrancy** — less critical than Solidity (no native ETH), but guard cross-contract calls that mutate shared state.

**L1↔L2 address mapping** — L1 `uint160` addresses must be validated when bridged to Starknet `felt252`. Invalid mapping routes to null address.

**Event emission** — always emit events for state changes, especially ownership and access control.

---

## Gas & Steps Awareness

Starknet has a **computational steps limit per transaction** — not gas like EVM. Hitting it causes a silent failure.

**Rules:**
- No unbounded loops over user-controlled or growing data — always enforce `MAX_BATCH`
- No deep recursion over large inputs — compiles to steps
- Cache `LegacyMap::read` in local variables inside loops
- Prefer `u128` over `u256` when range fits — `u256` is two `u128` under the hood
- `felt252` arithmetic is cheapest — use for IDs and hashes only

```cairo
// ❌ Unbounded — will hit steps limit on large inputs
fn sum_all(self: @ContractState) -> u256 {
    let mut total: u256 = 0;
    let mut i = 0;
    loop {
        if i >= self.entries.len() { break; }
        total += self.entries.read(i);
        i += 1;
    };
    total
}

// ✅ Bounded and predictable
const MAX_BATCH: u32 = 100;
fn sum_batch(self: @ContractState, from: u32, to: u32) -> u256 {
    assert(to - from <= MAX_BATCH, 'Batch too large');
    // ...
}
```

Emit events instead of storing enumerable data when off-chain indexing is available — Starknet has a rich indexer ecosystem.

---

## Naming Conventions (enforced)

- Internal functions: `_` prefix → `_convert_to_shares`, `_close_epoch`
- Internal parameters: `_` prefix → `fn _mint(ref self: ContractState, _to: ContractAddress, _amount: u256)`
- Public/external parameters: no prefix → `fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress)`
- Modules and functions: snake_case
- Structs, traits, enums: PascalCase
- Constants: SCREAMING_SNAKE_CASE
- Storage fields: snake_case → `total_shares`, `last_epoch_timestamp`
- Interfaces (traits): `I` prefix → `IVault`, `IToken`

---

## What Does NOT Exist in Cairo

- `delegatecall` → use Class Hash upgrades (Starknet native)
- `selfdestruct` → no equivalent
- `payable` / native ETH → use STRK or ERC20 explicitly
- `fallback()` / `receive()` → not supported
- Inline assembly → Sierra IR is the target; no EVM assembly
- `tx.gasprice` / `gasleft()` → different fee model
- `ecrecover` → use `starknet::secp256k1::recover_public_key` or STARK signatures
- Mapping iteration → not possible; track keys with arrays or events

---

## Contract Template

```cairo
// Interface — always define separately
#[starknet::interface]
trait IVault<TContractState> {
    fn deposit(ref self: TContractState, amount: u256);
    fn get_balance(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::contract]
mod Vault {
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::{ContractAddress, get_caller_address};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[storage]
    struct Storage {
        balances: LegacyMap<ContractAddress, u256>,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Deposited: Deposited,
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct Deposited {
        #[key]
        account: ContractAddress,
        amount: u256,
    }

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl VaultImpl of super::IVault<ContractState> {
        fn deposit(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            self.balances.write(caller, self.balances.read(caller) + amount);
            self.emit(Deposited { account: caller, amount });
        }

        fn get_balance(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
    }
}
```

---