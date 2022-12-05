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

    // Optimistic Asserter Harness getters
    getAssertionSettlementResolution(bytes32) returns (bool) envfree

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

definition select_MultiC(method f) returns bool = (f.selector == multicall(bytes[]).selector);

/**************************************************
 *                 Ghosts & Hooks                 *
 **************************************************/


/**************************************************
 *                  Misc. rules                   *
 **************************************************/

// A simple rule that checks which of the main contract methods
// are reachable (reach the assert false statement after function call).
 rule sanity(method f) {
    env e;
    calldataarg args;
    f(e, args);
    assert false;
}

rule whoChanged_cachedOracle(method f) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint256 cachedOracle1 = cachedOracle();
        f(e,args);
    uint256 cachedOracle2 = cachedOracle();

    assert cachedOracle1 == cachedOracle2;
}

rule whoChanged_burnedBondPercentage(method f)
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint256 burnPer1 = burnedBondPercentage();
        f(e,args);
    uint256 burnPer2 = burnedBondPercentage();

    assert burnPer1 == burnPer2;
}

rule whoChanged_defaultCurrency(method f)
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint256 defaultCurrency1 = defaultCurrency();
        f(e,args);
    uint256 defaultCurrency2 = defaultCurrency();

    assert defaultCurrency1 == defaultCurrency2;
}

rule whoChanged_settlementResolution(method f, bytes32 ID)
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    bool res1 = getAssertionSettlementResolution(ID);
        f(e, args);
    bool res2 = getAssertionSettlementResolution(ID);

    assert res1 == res2;
}


/**************************************************
 *           CVL Helper functions                 *
 **************************************************/
 