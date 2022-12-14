methods {
    // AddressWhitelist methods
    addToWhitelist(address) => DISPATCHER(true)
    removeFromWhitelist(address) => DISPATCHER(true)
    isOnWhitelist(address) returns (bool) => DISPATCHER(true)
    getWhitelist() returns (address[]) => DISPATCHER(true)

    // IdentifierWhitelist methods
    addSupportedIdentifier(bytes32) => DISPATCHER(true)
    removeSupportedIdentifier(bytes32) => DISPATCHER(true)
    isIdentifierSupported(bytes32) returns(bool) => DISPATCHER(true)

    // Store methods
    computeFinalFee(address) returns(uint256) => DISPATCHER(true)

    // Oracle Ancillary Interface
    getPrice(bytes32, uint256, bytes) => DISPATCHER(true)
    hasPrice(bytes32, uint256, bytes) => DISPATCHER(true)
    requestPrice(bytes32, uint256, bytes) => DISPATCHER(true)

    // EscalationManager methods
    getAssertionPolicy(bytes32) => DISPATCHER(true)
    assertionDisputedCallback(bytes32) => DISPATCHER(true)
    assertionResolvedCallback(bytes32, bool) => DISPATCHER(true)
}
