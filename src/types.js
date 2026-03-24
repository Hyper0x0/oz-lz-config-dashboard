/** VaultState mirrors the Solidity enum VaultState */
export var VaultState;
(function (VaultState) {
    VaultState[VaultState["Pending"] = 0] = "Pending";
    VaultState[VaultState["Active"] = 1] = "Active";
    VaultState[VaultState["Deprecated"] = 2] = "Deprecated";
    VaultState[VaultState["Closed"] = 3] = "Closed";
})(VaultState || (VaultState = {}));
