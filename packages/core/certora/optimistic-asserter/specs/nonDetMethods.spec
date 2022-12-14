methods {
    // AddressWhitelist methods
    addToWhitelist(address) => NONDET
    removeFromWhitelist(address) => NONDET
    isOnWhitelist(address) returns (bool) => NONDET
    getWhitelist() returns (address[]) => NONDET

    // IdentifierWhitelist methods
    addSupportedIdentifier(bytes32) => NONDET
    removeSupportedIdentifier(bytes32) => NONDET
    isIdentifierSupported(bytes32) returns(bool) => NONDET

    // Store methods
    computeFinalFee(address) returns(uint256) => NONDET

    // Oracle Ancillary Interface
    getPrice(bytes32, uint256, bytes) => NONDET
    hasPrice(bytes32, uint256, bytes) => NONDET
    requestPrice(bytes32, uint256, bytes) => NONDET

    // EscalationManager methods
    getAssertionPolicy(bytes32) => NONDET
    assertionDisputedCallback(bytes32) => NONDET
    assertionResolvedCallback(bytes32, bool) => NONDET
}
