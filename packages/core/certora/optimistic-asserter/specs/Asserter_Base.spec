import "./erc20.spec"
/**************************************************
 *      Top Level Properties / Rule Ideas         *
 **************************************************/

/**************************************************
 *                LINKED CONTRACTS                *
 **************************************************/
using Finder as finder
using Store as store

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

    // Optimistic Asserter Harness getters
    getAssertionSettlementResolution(bytes32) returns (bool) envfree
    getAssertionSettled(bytes32) returns (bool) envfree
    getAssertionBond(bytes32) returns (uint256) envfree
    getAssertionCurrency(bytes32) returns (address) envfree
    getAssertionExpirationTime(bytes32) returns (uint64) envfree
    getAssertionAsserter(bytes32) returns (address) envfree
    getAssertionDisputer(bytes32) returns (address) envfree
    getId(bytes,address,address,uint64,address,uint256,bytes32) returns (bytes32)
    tokenBalanceOf(address, address) returns (uint256) envfree

    // Finder methods
    finder.getImplementationAddress(bytes32) returns (address) envfree
    finder.changeImplementationAddress(bytes32, address) 

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

// Selector of the 'multiCall' method
definition isMultiCall(method f) returns bool = (f.selector == multicall(bytes[]).selector);
// Selector of the 'assert truth' methods
definition isAssertTruth(method f) returns bool = (f.selector == 0x6457c979 || f.selector == 0x36b13af4);
// Selector of the 'settleAssertion' methods
definition isSettle(method f) returns bool = (f.selector == 0x8ea2f2ab || f.selector == 0x4124beef);

/**************************************************
 *                 Ghosts & Hooks                 *
 **************************************************/
 // Uninterpreted ghost functions
 // See the methods block for replacement of contract methods with these functions. 
 // e.g. isDisputeAllowed(bytes32 ID, address caller) => isDisputeAllowed_G(ID, caller)
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