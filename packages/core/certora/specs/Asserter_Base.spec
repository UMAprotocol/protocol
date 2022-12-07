import "./erc20.spec"
/**************************************************
 *      Top Level Properties / Rule Ideas         *
 **************************************************/

/**************************************************
 *                LINKED CONTRACTS                *
 **************************************************/
using Finder as finder

/**************************************************
 *              METHODS DECLARATIONS              *
 **************************************************/
methods {
    // Asserter state variables getters
    cachedOracle() returns address envfree
    cachedCurrencies(address) returns (bool,uint256) envfree
    cachedIdentifiers(bytes32) returns (bool) envfree
    getAssertion(bytes32) envfree
    assertions(bytes32) envfree 
    burnedBondPercentage() returns (uint256) envfree
    defaultCurrency() returns (address) envfree
    defaultLiveness() returns (uint64) envfree
    owner() returns (address) envfree

    // A summary for the getId function, to avoid the hashing in the code.
    //_getId(bytes,uint256,uint256,uint64,address,address,address,bytes32) => NONDET

    // Optimistic Asserter Harness getters
    getAssertionSettlementResolution(bytes32) returns (bool) envfree
    getAssertionSettled(bytes32) returns (bool) envfree
    getAssertionBond(bytes32) returns (uint256) envfree
    getAssertionCurrency(bytes32) returns (address) envfree

    // Finder methods
    finder.getImplementationAddress(bytes32) returns (address) envfree
    finder.changeImplementationAddress(bytes32,address) 

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

    // Oracle pricing:
    getPrice(bytes32, uint256, bytes) => NONDET

    // EscalationManager methods
    requestPrice(bytes32, uint256, bytes) => DISPATCHER(true)
    getAssertionPolicy(bytes32) => DISPATCHER(true)
    assertionDisputedCallback(bytes32) => DISPATCHER(true)
    assertionResolvedCallback(bytes32, bool) => DISPATCHER(true)

    // Ghost summaries for escalation manager
    isDisputeAllowed(bytes32 ID, address caller) => isDisputeAllowed_G(ID, caller)
    _blockAssertion(bytes32 ID) returns (bool) => blockAssertion_G(ID)
    _arbitrateViaEscalationManager(bytes32 ID) returns (bool) => arbitrateViaEscalationManager_G(ID)
    _discardOracle(bytes32 ID) returns (bool) => discardOracle_G(ID)
    _validateDisputers(bytes32 ID) returns (bool) => validateDisputers_G(ID)
}

/**************************************************
 *                      ASSERTION                 *
 **************************************************/
/*

    struct EscalationManagerSettings {
        bool arbitrateViaEscalationManager; // False if the DVM is used as an oracle (EscalationManager on True).
        bool discardOracle; // False if Oracle result is used for resolving assertion after dispute.
        bool validateDisputers; // True if the SS isDisputeAllowed should be checked on disputes.
        address assertingCaller;
        address escalationManager;
    }

    getAssertion(bytes32) = 
        EscalationManagerSettings,
        address asserter; // Address of the asserter.
        uint64 assertionTime; // Time of the assertion.
        bool settled; // True if the request is settled.
        IERC20 currency; // ERC20 token used to pay rewards and fees.
        uint64 expirationTime;
        bool settlementResolution;
        bytes32 domainId;
        bytes32 identifier;
        uint256 bond;
        address callbackRecipient; // Address that receives the callback.
        address disputer; // Address of the disputer.
*/

/**************************************************
 *                 CVL Definitions                *
 **************************************************/

definition isMultiCall(method f) returns bool = (f.selector == multicall(bytes[]).selector);
definition isAssertTruth(method f) returns bool = (f.selector == 0xac9650d8 || f.selector == 0x715018a6);

/**************************************************
 *                 Ghosts & Hooks                 *
 **************************************************/
ghost blockAssertion_G(bytes32) returns bool;
ghost arbitrateViaEscalationManager_G(bytes32) returns bool;
ghost discardOracle_G(bytes32) returns bool;
ghost validateDisputers_G(bytes32) returns bool;
ghost mapping(bytes32 => mapping(address => bool)) isDisputeAllowedMapping;
 
/**************************************************
 *           CVL Helper functions                 *
 **************************************************/
 function isDisputeAllowed_G(bytes32 ID, address caller) returns bool {
    return isDisputeAllowedMapping[ID][caller];
 }