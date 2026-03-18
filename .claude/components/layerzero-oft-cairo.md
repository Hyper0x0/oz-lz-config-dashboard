# LayerZero OFT — Cairo / Starknet

> Load when implementing or integrating OFT on Starknet.
> Read alongside `.claude/dev/cairo.md` and `.claude/components/erc-standards-cairo.md`.
> For deployment steps, class hashes, and SDK details: query the MCP server (see CLAUDE.md).

---

## Variants — Choose One

| Variant | Use case | Mechanism |
|---|---|---|
| `OFTAdapter` | Existing token, no mint/burn access | lock → unlock |
| `OFTMintBurnAdapter` | Existing token with mint/burn permissions | burn → mint via adapter |

**Native OFT (new token) is not yet supported on Starknet** — use `OFTMintBurnAdapter` + `ERC20MintBurnUpgradeable`.

**⚠️ Only one lockbox OFTAdapter per token globally.** Same rule as EVM — multiple adapters cause permanent token loss.

---

## Decimal Precision

| Concept | Description | Typical value |
|---|---|---|
| Local decimals | Token decimals on Starknet | 18 |
| Shared decimals | Common precision across all chains | 6 |
| Conversion rate | `10^(local - shared)` | `10^12` |

**Shared decimals must be consistent across all chains.** Inconsistency allows double spending.

Dust is lost in conversion — always call `quote_oft` before sending to see exact amounts:
```rust
let quote = oft.quote_oft(send_param);
// quote.receipt.amount_sent_ld — actual debit
// quote.receipt.amount_received_ld — amount on destination
```

---

## Configuration Order — Never Deviate

```
1. Deploy ERC20MintBurnUpgradeable (or use existing token)
2. Deploy OFTMintBurnAdapter (or OFTAdapter)
3. Grant mint/burn role to adapter on token contract
4. Set delegate (before transferring ownership)
5. Set message libraries (explicit — never rely on defaults)
6. Configure DVNs — send and receive side per pathway
7. Configure executor
8. Set enforced options
9. Set peers — LAST — this opens the messaging channel
```

**Pathways are directional.** A→B and B→A must each be configured and verified separately.

---

## Role Management (OFTMintBurnAdapter)

| Role | Permission |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grant/revoke other roles |
| `FEE_MANAGER_ROLE` | Withdraw fees |
| `PAUSE_MANAGER_ROLE` | Pause/unpause |
| `RATE_LIMITER_MANAGER_ROLE` | Configure rate limits |
| `UPGRADE_MANAGER_ROLE` | Upgrade contract |

---

## Sending Tokens

```rust
let send_param = SendParam {
    dst_eid: 30101_u32,
    to: recipient_bytes32,
    amount_ld: 1_000_000_000_000_000_000_u256,
    min_amount_ld: 900_000_000_000_000_000_u256,
    extra_options: build_options(200000),
};

let messaging_fee = oft.quote_send(send_param, false);

// Approve STRK for fee
strk_token.approve(oft_address, messaging_fee.native_fee);
// If OFTAdapter: also approve token
// token.approve(oft_address, send_param.amount_ld);

let result = oft.send(send_param, messaging_fee, refund_address);
```

---

## Security Checklist

### Architecture
- [ ] Only one OFTAdapter deployed per token globally
- [ ] Shared decimals consistent with all EVM counterparts
- [ ] Local decimals can hold full intended max supply on Starknet
- [ ] Mint/burn role granted to adapter on token contract

### Configuration (per pathway, both directions)
- [ ] Libraries set explicitly — not relying on defaults
- [ ] DVNs configured on both send and receive side — at least 2 for production
- [ ] DVN config consistent on both sides of every pathway
- [ ] Enforced options set — gas profiled per message type
- [ ] Delegate set before transferring ownership
- [ ] Peers set last — after everything else

### Ownership
- [ ] OApp owner set to intended address
- [ ] Delegate set at EndpointV2 before ownership transfer
- [ ] Upgrade authority set correctly

### Code Quality
- [ ] No mock or test functions in production
- [ ] Using latest LayerZero packages — not copied source
- [ ] Tested on Sepolia before mainnet