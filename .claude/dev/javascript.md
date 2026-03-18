# JavaScript (Node.js) Standards

> For scripts, tooling, and Node.js contexts where TypeScript is not practical.
> Prefer TypeScript when possible — use this file only when JS is the right choice.

---

## File Structure

Split by responsibility. Keep files under **300 lines** — if a file grows beyond that, split it.

```
src/
├── types.js          ← @typedef declarations and shared JSDoc types
├── constants.js      ← global constants (SCREAMING_SNAKE_CASE)
├── errors.js         ← custom error classes
├── vault-client.js   ← feature module
├── vault-utils.js    ← reusable pure functions for vault domain
└── index.js          ← public API surface — re-exports only
```

**Rules:**
- `@typedef` declarations and shared types in `types.js` — never inline in the file that first uses them
- If a constant is used in more than one file, it belongs in `constants.js`
- If a function is needed in more than one file, extract it to a `*-utils.js` module
- `index.js` is for re-exports only — no logic

---

## Toolchain

- **Runtime**: Node.js LTS
- **Formatter**: Prettier (same `.prettierrc` as TS projects)
- **Linter**: ESLint + `eslint:recommended` + `eslint-config-prettier`
- **Testing**: Vitest or Jest
- **Validation**: Zod — mandatory on all external data (replaces compiler type safety)
- **Logger**: `pino` — never `console.log` in production

```json
// .prettierrc
{
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true,
  "printWidth": 100
}
```

```json
// .eslintrc
{
  "env": { "node": true, "es2022": true },
  "extends": ["eslint:recommended", "prettier"],
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" }
}
```

---

## Core Rules

- **ESM only** — `import`/`export`, never `require()` in new code
- **No `var`** — `const` by default, `let` only if reassigned
- **Async/await** over callbacks and `.then()` chains
- **Never swallow errors** — no `catch(e) {}`
- **No `console.log` in production** — use `pino`
- **`process.env` at entrypoint only** — pass as parameters
- **`process.exit(1)`** on fatal errors
- **No classes** where functions suffice — prefer composition
- **No metaprogramming** — no `Proxy`, `eval`, dynamic `require`

---

## Type Safety Without TypeScript

Without a compiler, runtime validation is mandatory everywhere. No exceptions.

```javascript
// ✅ JSDoc on all exported functions
/**
 * Submits a deposit request.
 * @param {string} _vaultAddress - Contract address (0x-prefixed hex)
 * @param {bigint} _amount - Amount in wei
 * @returns {Promise<string>} Transaction hash
 */
async function submitDeposit(_vaultAddress, _amount) {
  // ✅ Runtime type guard — the compiler won't save you here
  if (typeof _vaultAddress !== 'string' || !_vaultAddress.startsWith('0x')) {
    throw new TypeError(`Invalid vault address: ${_vaultAddress}`);
  }
  if (typeof _amount !== 'bigint' || _amount <= 0n) {
    throw new TypeError(`Invalid amount: ${_amount}`);
  }
  // ...
}

// ✅ Zod for external/API data
import { z } from 'zod';
const DepositSchema = z.object({
  amount: z.string().regex(/^\d+$/),
  receiver: z.string().startsWith('0x'),
});
const data = DepositSchema.parse(rawInput); // throws on invalid
```

---

## Naming

- Functions/variables: camelCase → `convertToShares`, `totalAssets`
- Constants: SCREAMING_SNAKE_CASE → `MAX_RETRIES`, `DEFAULT_TIMEOUT`
- Files: kebab-case → `deploy-script.js`, `vault-utils.js`
- Booleans: `is`/`has`/`can` prefix → `isValid`, `hasPermission`
- Private/internal helpers: `_` prefix → `_parseResponse`, `_validateInput`
- Parameters shadowing outer scope: `_` prefix → `_amount`, `_address`

---

## Node.js Specifics

- **File I/O**: `node:fs/promises` — never `readFileSync` in production
- **CLI**: `commander` — never parse `process.argv` manually
- **Env vars**: validate at startup with Zod, fail fast
- **DB transactions**: any operation that touches more than one table must use a transaction — never assume partial writes are safe
- **Financial math**: always use `BigInt` or ethers.js `parseUnits` / `formatUnits` — never `Number()`, `parseFloat()`, or `Math.*` on wei values; JavaScript `number` loses precision above 2^53
- **ethers.js version**: check `package.json` before writing ethers code — v5 and v6 have different APIs (`ethers.utils.parseUnits` vs `ethers.parseUnits`)
- **Secrets**: never in code, comments, or logs

```javascript
// ✅ Env validation at startup
import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  RPC_URL: z.string().url(),
});

export const env = Env.parse(process.env); // crash early if misconfigured
```

---

## Error Handling

```javascript
// ✅ Explicit — always handle or rethrow
async function fetchVaultData(_vaultAddress) {
  const response = await fetch(`${API_URL}/vault/${_vaultAddress}`);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// ❌ Silent — never do this
fetch(url).then(r => r.json()).catch(e => {});
```

---

## Pre-PR Checklist
- [ ] JSDoc on all exported/public functions
- [ ] All external data validated with Zod or explicit `typeof`/`instanceof` guards
- [ ] No `process.env` outside entrypoint
- [ ] All async functions have explicit error handling
- [ ] No `console.log` in production paths
- [ ] Private helpers prefixed with `_`
- [ ] No `eval`, `Proxy`, or dynamic `require`
- [ ] No raw SQL string interpolation
- [ ] No secrets in code, comments, or logs
- [ ] No unbounded loops over external data

---

## References
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Zod](https://zod.dev)
- [commander](https://github.com/tj/commander.js)
- [pino logger](https://getpino.io)