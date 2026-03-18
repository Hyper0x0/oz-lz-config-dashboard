# /migrate — Solidity → Cairo Migration Command

> Read `dev/solidity.md` and `dev/cairo.md` alongside this file.
> Key mindset: this is NOT a translation. Rewrite idiomatically in Cairo.

---

## Process

1. **Read `SPEC.md` first** if it exists in the repo root. It is the source of truth. If the Solidity code contradicts the spec, stop and ask: *"The spec says X but the code does Y — which should the Cairo implementation follow?"* Do not proceed until confirmed.
2. **Identify what does not exist in Cairo** (see table below) and flag it
3. **Map each pattern** using the guide below
4. **Rewrite idiomatically** — do not transliterate line by line
5. **Ask for confirmation** on any architectural decision that changes behavior

---

## Conceptual Mapping

| EVM / Solidity | Starknet / Cairo |
|---|---|
| Storage slots | `#[storage]` struct fields |
| `mapping(address => uint256)` | `LegacyMap<ContractAddress, u256>` |
| `mapping(a => mapping(b => c))` | `LegacyMap<(ContractAddress, ContractAddress), u256>` |
| `uint256` arithmetic | `u256` |
| `uint256` IDs / hashes | `felt252` |
| `address` | `ContractAddress` |
| `msg.sender` | `get_caller_address()` |
| `msg.value` | Not applicable — use ERC20 explicitly |
| `block.timestamp` | `get_block_timestamp()` |
| `block.number` | `get_block_number()` |
| `emit Transfer(...)` | `self.emit(Transfer { ... })` |
| `require(cond, "msg")` | `assert(cond, 'msg')` |
| `revert CustomError()` | `panic_with_felt252('code')` or `panic` |
| `modifier onlyOwner` | `self.ownable.assert_only_owner()` |
| `interface IFoo` | `#[starknet::interface] trait IFoo<T>` |
| `library` (stateless) | Cairo module (no storage) |
| `delegatecall` | Class Hash upgrades |
| `constructor` | `#[constructor]` fn + OZ initializers |
| `event E(address indexed x)` | `struct E { #[key] x: ContractAddress }` |

---

## What Does NOT Exist — Flag and Confirm

Before migrating, identify and flag these patterns to the user:

| Pattern | Cairo alternative | Action |
|---|---|---|
| `delegatecall` | Class Hash upgrades | Confirm upgrade strategy |
| `selfdestruct` | No equivalent | Confirm if needed at all |
| `payable` / ETH | STRK or ERC20 | Confirm token choice |
| `fallback()` / `receive()` | Not supported | Remove or redesign |
| Mapping iteration | Track keys in array or events | Confirm off-chain indexing available |
| `ecrecover` | `secp256k1::recover_public_key` | Verify signature scheme |
| Assembly | Not supported | Redesign at algorithm level |

---

## Pattern Migrations

### Ownership
```solidity
import "@openzeppelin/contracts/access/Ownable.sol";
contract Foo is Ownable {
    function adminAction() external onlyOwner { ... }
}
```
```cairo
use openzeppelin::access::ownable::OwnableComponent;
component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
#[abi(embed_v0)]
impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

fn admin_action(ref self: ContractState) {
    self.ownable.assert_only_owner();
}
```

### ERC20
```solidity
contract MyToken is ERC20 {
    constructor() ERC20("MyToken", "MTK") { _mint(msg.sender, 1000e18); }
}
```
```cairo
use openzeppelin::token::erc20::{ERC20Component, ERC20HooksEmptyImpl};
component!(path: ERC20Component, storage: erc20, event: ERC20Event);
#[abi(embed_v0)]
impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

#[constructor]
fn constructor(ref self: ContractState, recipient: ContractAddress) {
    self.erc20.initializer("MyToken", "MTK");
    self.erc20.mint(recipient, 1000_000000000000000000_u256);
}
```

### Nested Mappings
```solidity
mapping(address => mapping(address => uint256)) public allowances;
allowances[owner][spender] = amount;
```
```cairo
#[storage]
struct Storage {
    allowances: LegacyMap<(ContractAddress, ContractAddress), u256>,
}
self.allowances.write((owner, spender), amount);
```

### Events
```solidity
event Transfer(address indexed from, address indexed to, uint256 value);
emit Transfer(from, to, value);
```
```cairo
#[event]
#[derive(Drop, starknet::Event)]
enum Event { Transfer: Transfer }

#[derive(Drop, starknet::Event)]
struct Transfer {
    #[key] from: ContractAddress,
    #[key] to: ContractAddress,
    value: u256,
}
self.emit(Transfer { from, to, value });
```

### Errors
```solidity
error InsufficientBalance(uint256 available, uint256 required);
revert InsufficientBalance(balance, amount);
```
```cairo
assert(balance >= amount, 'Insufficient balance');
// or:
if balance < amount { panic_with_felt252('Insufficient balance'); }
```

### Reentrancy Guard
```solidity
contract Foo is ReentrancyGuard {
    function withdraw() external nonReentrant { ... }
}
```
```cairo
use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);
impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

fn withdraw(ref self: ContractState) {
    self.reentrancy_guard.start();
    // ...
    self.reentrancy_guard.end();
}
```

### Constructor
```solidity
constructor(address _owner, uint256 _value) {
    owner = _owner;
    value = _value;
}
```
```cairo
#[constructor]
fn constructor(ref self: ContractState, owner: ContractAddress, value: u256) {
    self.ownable.initializer(owner);
    self.value.write(value);
}
```

---

## Migration Checklist

- [ ] All `payable` functions refactored to explicit ERC20 transfers
- [ ] All `address` → `ContractAddress` from `starknet`
- [ ] All `msg.sender` → `get_caller_address()`
- [ ] All `block.timestamp` → `get_block_timestamp()`
- [ ] All `uint256` usage audited: financial math → `u256`, IDs/hashes → `felt252`
- [ ] No `felt252` used for arithmetic that can overflow
- [ ] All `mapping` → `LegacyMap` (no iteration)
- [ ] All `interface` → `#[starknet::interface] trait`
- [ ] OZ Solidity components replaced with OZ Cairo components (different APIs)
- [ ] All `emit EventName(...)` → `self.emit(EventName { ... })`
- [ ] All `require(cond, "msg")` → `assert(cond, 'msg')`
- [ ] All `revert CustomError(...)` → `panic` + felt252 message
- [ ] All `delegatecall` patterns replaced with Class Hash upgrades
- [ ] L1↔L2 bridge address validation added at boundary
- [ ] All loops have explicit max bounds
- [ ] Tests written with `snforge` — Forge patterns do not translate directly
- [ ] Caracal run after migration