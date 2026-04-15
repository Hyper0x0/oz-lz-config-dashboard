# OZ / LZ Config Dashboard

Operator dashboard for managing **LayerZero V2** cross-chain OFT deployments, governed by **OpenZeppelin TimelockController**, across EVM and Starknet networks.

Built for protocol teams that operate OFT bridges behind a timelock and need a single interface to schedule governance operations, wire cross-chain peers, configure DVNs, and manage access control roles — all without writing scripts or crafting raw calldata by hand.

### Multisig-friendly

The dashboard works with **multisig wallets** (e.g. Gnosis Safe). Connect your multisig signer through MetaMask or an injected wallet, and every transaction the dashboard generates — scheduling timelock operations, setting peers, configuring DVNs — can be proposed, signed, and executed through your multisig flow. This makes it suitable for production deployments where protocol operations require multiple approvals before execution.

## Features

- **Timelock Operations** — Schedule, inspect, and execute timelock-protected operations (register vaults, set fees, protocol upgrades) with live countdown timers. Derive operation IDs from past schedule transactions, scan on-chain event logs for pending operations, and execute them once the delay has elapsed.
- **OApp / OFT Wiring** — Multi-step wizard to configure cross-chain peers, enforced options, rate limits, and DVN selection. Supports EVM ↔ EVM and EVM ↔ Starknet pathways with on-chain verification at each step.
- **OFT Bridge** — View and configure OFT adapter and peer contracts as a swap-style card interface. Verify endpoint configuration and check send/receive library settings.
- **Role Management** — Grant and revoke Proposer, Executor, Canceller, and Admin roles on the TimelockController. Check which roles the connected wallet holds.
- **Configuration Verification** — Live validation of cross-chain config against on-chain state, with severity levels (critical / warning / info) highlighting mismatches or missing settings.
- **Multi-Wallet** — EVM (MetaMask) + Starknet (ArgentX / Braavos) wallet support with auto-reconnect and testnet/mainnet toggle.

## Tech Stack

- **React 18** + React Router + TypeScript
- **Vite** for dev server and builds
- **Tailwind CSS** for styling
- **ethers.js v6** for EVM interaction
- **starknet.js v6** + starknetkit for Starknet interaction
- **@layerzerolabs** SDK packages

## Getting Started

### Prerequisites

- Node.js 16+
- npm

### Install

```bash
npm install
```

### Environment

Create a `.env.local` file:

```env
VITE_ARBISCAN_KEY=<your_arbiscan_api_key>
```

### Run

```bash
npm run dev
```

Opens at `http://localhost:5173`.

