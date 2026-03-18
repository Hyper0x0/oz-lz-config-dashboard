# Ops Dashboard — Scaffold

Minimal React app for protocol operators. Covers:
1. AdminGateway timelock operations (schedule / execute)
2. OFT wiring — EVM ↔ EVM and EVM ↔ Cairo

Stack: **React + ethers.js v6 + starknet.js v6**

---

## Project structure

```
ops-dashboard/
├── public/
├── src/
│   ├── abis/
│   │   ├── AdminGateway.json          # ABI from forge inspect
│   │   ├── SyOFTAdapter.json
│   │   └── SySharePeer.json
│   │
│   ├── config/
│   │   └── chains.ts                  # RPC urls, chain ids, contract addresses per chain
│   │
│   ├── hooks/
│   │   ├── useEvmWallet.ts            # ethers BrowserProvider + Signer
│   │   ├── useStarknetWallet.ts       # starknet.js WalletAccount (ArgentX / Braavos)
│   │   ├── useTimelockOps.ts          # read pending ops, isReady, execute
│   │   └── useOFTWiring.ts            # setPeer / setEnforcedOptions / setRateLimits
│   │
│   ├── pages/
│   │   ├── Timelock.tsx               # schedule + execute dashboard
│   │   └── OFTWiring.tsx              # EVM<->EVM and EVM<->Cairo wiring forms
│   │
│   ├── components/
│   │   ├── EvmWalletButton.tsx        # connect MetaMask
│   │   ├── StarknetWalletButton.tsx   # connect ArgentX / Braavos
│   │   ├── OpCard.tsx                 # single pending timelock op with countdown
│   │   └── TxStatus.tsx               # pending / success / error banner
│   │
│   ├── utils/
│   │   ├── abiEncode.ts               # encodeCall helpers (registerVault, setFees, ...)
│   │   ├── cairoAddress.ts            # felt252 <-> bytes32 conversion
│   │   └── timelock.ts                # hashOperation, formatDelay, isReady
│   │
│   └── App.tsx                        # router: / = Timelock, /wiring = OFTWiring
│
├── package.json
└── .env.local                         # VITE_* contract addresses per chain
```

---

## Key dependencies

```json
{
  "react": "^18",
  "react-router-dom": "^6",
  "ethers": "^6",
  "starknet": "^6",
  "vite": "^5"
}
```

No wagmi, no rainbowkit — direct ethers + starknet.js to keep it minimal.

---

## Wallet connections

### EVM — `useEvmWallet.ts`

```ts
import { BrowserProvider, JsonRpcSigner } from "ethers";

export function useEvmWallet() {
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);

  async function connect() {
    const provider = new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    setSigner(await provider.getSigner());
  }

  return { signer, connect };
}
```

### Starknet — `useStarknetWallet.ts`

```ts
import { connect } from "starknetkit";           // starknetkit wraps ArgentX + Braavos
import { WalletAccount, RpcProvider } from "starknet";

export function useStarknetWallet() {
  const [account, setAccount] = useState<WalletAccount | null>(null);

  async function connect() {
    const { wallet } = await connect();           // opens wallet selector modal
    const provider = new RpcProvider({ nodeUrl: import.meta.env.VITE_STARKNET_RPC });
    setAccount(new WalletAccount(provider, wallet));
  }

  return { account, connect };
}
```

> starknetkit (by ArgentX team) is the cleanest way to support both ArgentX and Braavos
> with a single `connect()` call. Add it: `npm i starknetkit`

---

## Page: Timelock

### What it does
- Lists all pending timelock ops (read from `AdminGateway` events or hardcoded salts)
- Shows countdown to `eta` (block.timestamp + delay)
- Execute button enabled when `isOperationReady(opId) == true`
- Forms to schedule: registerVault / setVaultState / setFees / setFeeRecipient

### Core hook — `useTimelockOps.ts`

```ts
import { Contract } from "ethers";
import AdminGatewayABI from "../abis/AdminGateway.json";

export function useTimelockOps(signer, adminGatewayAddr: string) {
  const contract = new Contract(adminGatewayAddr, AdminGatewayABI, signer);

  async function schedule(target, value, data, predecessor, salt, delay) {
    const tx = await contract.schedule(target, value, data, predecessor, salt, delay);
    await tx.wait();
  }

  async function execute(target, value, data, predecessor, salt) {
    const opId = await contract.hashOperation(target, value, data, predecessor, salt);
    const ready = await contract.isOperationReady(opId);
    if (!ready) throw new Error("Operation not ready");
    const tx = await contract.execute(target, value, data, predecessor, salt);
    await tx.wait();
  }

  async function getMinDelay() {
    return contract.getMinDelay();
  }

  return { schedule, execute, getMinDelay };
}
```

### ABI-encode helpers — `utils/abiEncode.ts`

```ts
import { AbiCoder, Interface } from "ethers";
import AdminGatewayABI from "../abis/AdminGateway.json";

const iface = new Interface(AdminGatewayABI);

export const encodeRegisterVault = (vault, pool, share, oft) =>
  iface.encodeFunctionData("registerVault", [vault, pool, share, oft]);

export const encodeSetVaultState = (vaultId, state) =>
  iface.encodeFunctionData("setVaultState", [vaultId, state]);

export const encodeSetPerformanceFee = (vaultId, bps) =>
  iface.encodeFunctionData("setPerformanceFeeBps", [vaultId, bps]);

export const encodeSetFeeRecipient = (vaultId, recipient) =>
  iface.encodeFunctionData("setFeeRecipient", [vaultId, recipient]);
```

---

## Page: OFT Wiring

### What it does
- EVM ↔ EVM: connects MetaMask, switches network, calls setPeer / setEnforcedOptions / setRateLimits on adapter and peer
- EVM ↔ Cairo: connects MetaMask (EVM side) + ArgentX (Cairo side), wires both contracts in sequence

### Core hook — `useOFTWiring.ts`

```ts
import { Contract } from "ethers";
import { Contract as StarkContract } from "starknet";

export function useOFTWiring(evmSigner, starkAccount) {
  // ── EVM → EVM ──────────────────────────────────────────────────────────────

  async function setEvmPeer(adapterAddr, peerEid, peerAddr) {
    const adapter = new Contract(adapterAddr, SyOFTAdapterABI, evmSigner);
    const peerBytes32 = "0x" + peerAddr.slice(2).padStart(64, "0");
    await (await adapter.setPeer(peerEid, peerBytes32)).wait();
  }

  async function setEvmEnforcedOptions(adapterAddr, peerEid, gas = 80_000n) {
    // Options encoding mirrors OptionsBuilder.addExecutorLzReceiveOption
    // Type 3 options: 0x0003 + type1(lzReceive) = 0x00030100110100000000000000000000000000000000[gas as uint128]
    const opts = buildLzReceiveOption(gas);
    const adapter = new Contract(adapterAddr, SyOFTAdapterABI, evmSigner);
    await (await adapter.setEnforcedOptions([{ eid: peerEid, msgType: 1, options: opts }])).wait();
  }

  async function setRateLimit(adapterAddr, peerEid, limit, window) {
    const adapter = new Contract(adapterAddr, SyOFTAdapterABI, evmSigner);
    await (await adapter.setRateLimits([{ dstEid: peerEid, limit, window }])).wait();
  }

  // ── EVM → Cairo (adapter side only — Cairo side below) ────────────────────

  async function setEvmPeerToCairo(adapterAddr, cairoEid, cairoAddrFelt) {
    // cairoAddrFelt: Starknet contract address as hex string (e.g. "0x04a3...")
    const peerBytes32 = "0x" + BigInt(cairoAddrFelt).toString(16).padStart(64, "0");
    const adapter = new Contract(adapterAddr, SyOFTAdapterABI, evmSigner);
    await (await adapter.setPeer(cairoEid, peerBytes32)).wait();
  }

  // ── Cairo side — setPeer on the Cairo OFT contract ─────────────────────────

  async function setCairoPeer(cairoOftAddr, adapterEid, adapterEvmAddr) {
    // adapterEvmAddr: EVM address converted to felt252
    const adapterAsFelt = BigInt(adapterEvmAddr).toString();
    const contract = new StarkContract(CairoOFTPeerABI, cairoOftAddr, starkAccount);
    // Cairo LZ OFT exposes set_peer(eid: u32, peer: u256)
    await contract.invoke("set_peer", [adapterEid, { low: adapterAsFelt, high: "0" }]);
  }

  return { setEvmPeer, setEvmEnforcedOptions, setRateLimit, setEvmPeerToCairo, setCairoPeer };
}
```

### Cairo address conversion — `utils/cairoAddress.ts`

```ts
// EVM address (20 bytes) → felt252 (safe — fits in 252 bits)
export const evmToFelt = (evmAddr: string): bigint =>
  BigInt(evmAddr);

// felt252 → bytes32 (for EVM setPeer)
export const feltToBytes32 = (felt: bigint): string =>
  "0x" + felt.toString(16).padStart(64, "0");

// Starknet address string → bigint felt252
export const starknetAddrToFelt = (addr: string): bigint =>
  BigInt(addr);
```

---

## EVM ↔ Cairo wiring flow (UI sequence)

```
1. User connects MetaMask (EVM home chain)
2. User connects ArgentX/Braavos (Starknet)
3. User fills form:
     Adapter address (EVM)     [ADAPTER]
     Cairo OFT address         [CAIRO_OFT]
     Adapter EID               [ADAPTER_EID]
     Cairo EID                 [CAIRO_EID]
4. Click "Wire EVM side"  → setEvmPeerToCairo()    (MetaMask signs)
5. Click "Wire Cairo side" → setCairoPeer()         (ArgentX signs)
6. Done — channel open
```

---

## `.env.local` example

```
VITE_HOME_RPC=https://mainnet.base.org
VITE_REMOTE_RPC=https://arb1.arbitrum.io/rpc
VITE_STARKNET_RPC=https://starknet-mainnet.public.blastapi.io

VITE_ADMIN_GATEWAY=0x...
VITE_ADAPTER=0x...
VITE_PEER=0x...
VITE_CAIRO_OFT=0x...

VITE_ADAPTER_EID=30184
VITE_PEER_EID=30110
VITE_CAIRO_EID=...
```

---

## Notes

- `buildLzReceiveOption(gas)` must reproduce the same byte encoding as
  `OptionsBuilder.addExecutorLzReceiveOption` from the LZ SDK. Copy the encoding from
  `@layerzerolabs/lz-v2-utilities` (`Options.newOptions().addExecutorLzReceiveOption(gas, 0).toHex()`).
- Cairo OFT ABI: get from the deployed Cairo OFT contract (it will be the LZ Cairo OFT standard).
  The function name and parameter types may vary — verify against the actual deployment.
- For production: replace direct signer calls with a Gnosis Safe SDK flow
  (`SafeApiKit` + `SafeTransactionService`) so the multisig can review before signing.
