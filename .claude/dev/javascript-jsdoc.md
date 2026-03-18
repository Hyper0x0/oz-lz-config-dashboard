# JSDoc — JavaScript (Node.js)

> When and how to document JavaScript code.
> JSDoc replaces compiler type safety in plain JS — mandatory on all exports.

---

## JSDoc — JavaScript (Node.js)

Mandatory on all exported functions and modules. JSDoc replaces type safety in plain JS — without it Claude has no contract to work against.

### Exported Functions
```javascript
/**
 * Submits a deposit request to the vault contract.
 *
 * @param {string} vaultAddress - Contract address (0x-prefixed hex)
 * @param {bigint} amount - Amount in wei
 * @param {string} receiver - Recipient address (0x-prefixed hex)
 * @returns {Promise<string>} Transaction hash
 * @throws {TypeError} If any argument fails validation
 * @throws {Error} If the RPC call fails
 */
async function submitDeposit(vaultAddress, amount, receiver) { ... }
```

### Modules / Files
```javascript
/**
 * @module vault-client
 * @description HTTP client for interacting with the vault API.
 *              Handles retries, rate limiting, and error normalization.
 */
```

### Callbacks and Complex Types
```javascript
/**
 * @typedef {Object} DepositResult
 * @property {string} txHash - Transaction hash
 * @property {bigint} sharesReceived - Shares minted in wei
 * @property {number} blockNumber - Block where tx was included
 */

/**
 * @callback OnDepositConfirmed
 * @param {DepositResult} result
 * @returns {void}
 */
```

**Rules:**
- Every exported function: `@param`, `@returns`, `@throws` (if it throws)
- Every `@typedef` for objects used across more than one function
- No JSDoc on private `_` helpers unless logic is non-obvious
- Keep descriptions one line unless the behavior genuinely needs explanation

---