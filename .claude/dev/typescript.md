# TypeScript Standards

> For Node.js backend, scripts, and tooling. JS-specific rules are in `javascript.md`.

---

## File Structure

Split by responsibility. Keep files under **300 lines** — if a file grows beyond that, split it.

```
src/
├── types.ts          ← all shared types, interfaces, enums
├── constants.ts      ← global constants (SCREAMING_SNAKE_CASE)
├── errors.ts         ← custom error classes
├── vault-client.ts   ← feature module
├── vault-utils.ts    ← reusable pure functions for vault domain
└── index.ts          ← public API surface — re-exports only
```

**Rules:**
- Types, constants, and errors in dedicated files — never defined inline in the module that first needs them
- If a type or error is used in more than one file, it must live in `types.ts` or `errors.ts`
- If a function is needed in more than one file, extract it to a `*-utils.ts` or `*-lib.ts` module
- `index.ts` is for re-exports only — no logic

---

## Toolchain

- **Runtime**: Node.js LTS
- **Formatter**: Prettier
- **Linter**: ESLint + `@typescript-eslint/recommended` + `eslint-config-prettier`
- **Testing**: Vitest (preferred) or Jest
- **Validation**: Zod — mandatory for all external data
- **ORM**: Drizzle ORM (preferred) or Prisma
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
// tsconfig.json — mandatory
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

---

## Core Rules

- **ESM only** — `import`/`export`, never `require()`
- **No `var`** — `const` by default, `let` only if reassigned
- **No `any`** — use `unknown` + narrowing, or define the type
- **No `!` non-null assertion** — guard with `if` or use `?.`
- **Explicit return types** on public functions and module exports
- **After changing any function signature, shared `type`, or `interface`**: run `tsc --noEmit` to catch all broken call sites before committing — the compiler finds every inconsistency, but only if you run it
- **Never swallow errors** — no `catch(e) {}`
- **`process.env` at entrypoint only** — pass as parameters, never access deep in the code
- **`process.exit(1)`** on fatal errors — do not leave the process hanging

---

## Naming

- Functions/variables: camelCase → `convertToShares`, `totalAssets`
- Classes, Types, Interfaces: PascalCase → `VaultConfig`, `DepositRequest`
- Constants: SCREAMING_SNAKE_CASE → `MAX_RETRIES`, `DEFAULT_TIMEOUT`
- Files: kebab-case → `vault-manager.ts`, `deploy-script.ts`
- Booleans: `is`/`has`/`can` prefix → `isValid`, `hasPermission`
- Private/internal helpers: `_` prefix → `_parseResponse`, `_validateInput`
- Parameters shadowing outer scope: `_` prefix → `_amount`, `_address`
- `type` for unions and mapped types; `interface` for extensible object shapes
- Path aliases: `@/` for `src/` — never `../../..`

---

## Patterns

```typescript
// ✅ Result type for expected errors
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// ✅ Custom error with context
class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ✅ Zod for external data
const DepositSchema = z.object({
  amount: z.string().regex(/^\d+$/),
  receiver: z.string().startsWith('0x'),
});
type Deposit = z.infer<typeof DepositSchema>;

// ✅ Env validation at startup — fail fast
const Env = z.object({
  DATABASE_URL: z.string().url(),
  RPC_URL: z.string().url(),
  PRIVATE_KEY: z.string().min(64),
});
export const env = Env.parse(process.env);
```

---

## Node.js Specifics

- **File I/O**: `node:fs/promises` — never `readFileSync` in production
- **CLI**: `commander` — never parse `process.argv` manually
- **DB transactions**: any operation that touches more than one table must use a transaction — never assume partial writes are safe
- **Financial math**: always use `BigInt` or ethers.js `parseUnits` / `formatUnits` — never `Number()`, `parseFloat()`, or `Math.*` on wei values; JavaScript `number` loses precision above 2^53
- **ethers.js version**: check `package.json` before writing ethers code — v5 and v6 have different APIs (`ethers.utils.parseUnits` vs `ethers.parseUnits`)
- **Secrets**: never in code, comments, or logs; always from env vars validated at startup
- **Signing functions**: explicit input validation before signing — treat as security boundary

---

## Pre-PR Checklist
- [ ] `tsc --noEmit` passes with zero errors — run after any signature, type, or interface change
- [ ] No `any` types
- [ ] All external data validated with Zod at the boundary
- [ ] No `process.env` outside entrypoint
- [ ] All async functions have explicit error handling
- [ ] No `console.log` in production paths
- [ ] Private helpers prefixed with `_`
- [ ] No raw SQL string interpolation — typed ORM queries only
- [ ] No secrets in code, comments, or logs
- [ ] DB connections use pooling with explicit limits
- [ ] Functions touching wallets/signing have input validation before signing
- [ ] No unbounded loops over external data — pagination or limit enforced
- [ ] API error messages are generic — internal details logged server-side only

---

## References
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [typescript-eslint Rules](https://typescript-eslint.io/rules/)
- [Zod](https://zod.dev)
- [Drizzle ORM](https://orm.drizzle.team/docs/overview)
- [Total TypeScript](https://www.totaltypescript.com/tips)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)