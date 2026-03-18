# ERC Standards — Cairo / Starknet

> Load when implementing an ERC standard in Cairo.
> Read alongside `.claude/dev/cairo.md`.
> OZ Cairo components use a different API than OZ Solidity — never assume parity.

---

## General Rules

- Use [OpenZeppelin Contracts for Cairo 3.x](https://docs.openzeppelin.com/contracts-cairo/3.x) — never reimplement from scratch
- Cairo components are mixed in via `#[storage]`, `#[event]`, and `impl` blocks — not inherited
- All amounts use `u256` — never `felt252` for token balances
- Emit every required event — same requirement as Solidity

---

## ERC-20 — Fungible Token

**OZ component**: `ERC20Component`

```cairo
#[starknet::contract]
mod MyToken {
    use openzeppelin::token::erc20::{ERC20Component, ERC20HooksEmptyImpl};
    use starknet::ContractAddress;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);

    #[abi(embed_v0)]
    impl ERC20Impl = ERC20Component::ERC20Impl<ContractState>;
    #[abi(embed_v0)]
    impl ERC20MetadataImpl = ERC20Component::ERC20MetadataImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, recipient: ContractAddress) {
        self.erc20.initializer("MyToken", "MTK");
        self.erc20.mint(recipient, 1_000_000_u256);
    }
}
```

**Rules:**
- `initializer` must be called in constructor — sets name and symbol
- Use `erc20.mint` / `erc20.burn` for internal operations
- `u256` for all amounts — never `felt252`

---

## ERC-721 — Non-Fungible Token

**OZ component**: `ERC721Component`

```cairo
component!(path: ERC721Component, storage: erc721, event: ERC721Event);

#[abi(embed_v0)]
impl ERC721Impl = ERC721Component::ERC721Impl<ContractState>;
#[abi(embed_v0)]
impl ERC721MetadataImpl = ERC721Component::ERC721MetadataImpl<ContractState>;
impl ERC721InternalImpl = ERC721Component::InternalImpl<ContractState>;
```

**Rules:**
- Token IDs use `u256`
- `safe_mint` preferred over `mint` — checks receiver
- `base_uri` set via `initializer` call

---

## ERC-1155 — Multi-Token

**OZ component**: `ERC1155Component`

```cairo
component!(path: ERC1155Component, storage: erc1155, event: ERC1155Event);

#[abi(embed_v0)]
impl ERC1155Impl = ERC1155Component::ERC1155Impl<ContractState>;
impl ERC1155InternalImpl = ERC1155Component::InternalImpl<ContractState>;
```

**Rules:**
- Amounts always `u256`
- Batch operations require both `ids` and `values` arrays of equal length
- Receiver contracts must implement `IERC1155Receiver`

---

## ERC-4626 — Tokenized Vault

No official OZ Cairo component yet. If implementing manually:

**Rules:**
- Same rounding rules as Solidity — read `erc-standards-solidity.md` rounding table
- All amounts `u256` — arithmetic in `u256` throughout
- `total_assets` must include all protocol-owned assets
- Inflation attack mitigation: virtual shares or seeded initial deposit

---

## Access Control

**OZ components**: `OwnableComponent`, `AccessControlComponent`

```cairo
// Ownable
component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

#[abi(embed_v0)]
impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

// In constructor:
self.ownable.initializer(owner);

// In protected function:
self.ownable.assert_only_owner();
```

```cairo
// AccessControl — for multi-role systems
component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);

const MINTER_ROLE: felt252 = selector!("MINTER_ROLE");

// Grant role:
self.access_control.grant_role(MINTER_ROLE, minter_address);

// Check role:
self.access_control.assert_only_role(MINTER_ROLE);
```

---

## Upgradeable Contracts

**OZ component**: `UpgradeableComponent`

```cairo
component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);

impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

// Upgrade function — always gate with owner or role
#[external(v0)]
fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
    self.ownable.assert_only_owner();
    self.upgradeable.upgrade(new_class_hash);
}
```

**Rules:**
- Storage layout must be preserved between upgrades — append only
- Always gate `upgrade` with access control
- Test upgrade on testnet before mainnet

---

## Pre-Implementation Checklist

- [ ] Using OZ Cairo 3.x component — not custom implementation
- [ ] `#[substorage(v0)]` on all component storage fields
- [ ] `initializer` called for every component in constructor
- [ ] All amounts `u256` — no `felt252` for balances
- [ ] Required events emitted (via component or manual)
- [ ] Receiver interfaces implemented if contract receives tokens

---

## References
- [OpenZeppelin Contracts Cairo 3.x](https://docs.openzeppelin.com/contracts-cairo/3.x)
- [OZ Cairo GitHub](https://github.com/OpenZeppelin/cairo-contracts)
- [Starknet docs — ERC20](https://docs.starknet.io/architecture-and-concepts/accounts/standard-account/)