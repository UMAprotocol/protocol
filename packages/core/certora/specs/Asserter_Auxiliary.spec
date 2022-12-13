// For every new spec you create, import this basic spec file:
import "./Asserter_Base.spec"
import "./dispatchedMethods.spec"

using TestnetERC20 as testERC20
/**************************************************
 *      Top Level Properties / Rule Ideas         *
 **************************************************/
// Here you can write your ideas for rules and implement them 
// in this spec.

/**************************************************
 *                  Misc. rules                   *
 **************************************************/

// A simple rule that checks which of the main contract methods
// are reachable (reach the assert false statement after function call).
 rule sanity(method f) {
    env e;  // Environment variable - includes all transaction and block information.
    calldataarg args; // arbitrary calldata - adapted for every method signature implicitly
    f(e, args);
    assert false;
}

// Checks that view functions in the contract never revert. 
rule viewFuncsDontRevert(method f) 
filtered{f -> f.isView} { // filters the methods to only view functions
    env e;
    require e.msg.value == 0;
    calldataarg args;
    f@withrevert(e, args);

    assert !lastReverted;
}

/**************************************************
 *                 "Who changed" Rules            *
 **************************************************/
// This type of rules calls any of the main contract's public/external methods
// and checks whether a state variable was changed after the 
// invocation of this function.

rule whoChanged_cachedOracle(method f) 
filtered{f -> !f.isView} { // We filter out view functions as they do not change state variables.
    env e;
    calldataarg args;
    uint256 cachedOracle1 = cachedOracle();
        f(e, args);
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

rule whoChanged_assertionBond(method f, bytes32 ID)
filtered{f -> !f.isView && !isMultiCall(f)} {
    env e;
    calldataarg args;
    uint256 bond1 = getAssertionBond(ID);
        f(e, args);
    uint256 bond2 = getAssertionBond(ID);

    assert bond1 == bond2;
}

rule whoChanged_assertionCurrency(method f, bytes32 ID)
filtered{f -> !f.isView && !isMultiCall(f)} {
    env e;
    calldataarg args;
    address currency1 = getAssertionCurrency(ID);
        f(e, args);
    address currency2 = getAssertionCurrency(ID);

    assert currency1 == currency2;
}

/*************************************************
*                Custom rules                    *
**************************************************/
// If calling 'assertTruth' twice, it cannot yield the same assertion ID.
rule cannotAssertTruthTwiceForSameID() {
    env e1;
    env e2;
    calldataarg args1; 
    calldataarg args2;
    bytes32 ID1 = assertTruth(e1, args1);
    bytes32 ID2 = assertTruth(e2, args2);

    // It's enough to check this rule for a single instance of the currency
    require getAssertionCurrency(ID1) == testERC20;
    require getAssertionCurrency(ID2) == testERC20;
    assert ID1 != ID2;
}

// This rule makes sure that if we can call assertTruth with some parameters 
// (without reverting), then we can call it again with the same parameters but
// just changing the liveness.
rule assertTruthSucceedsForEveryLiveness(uint64 liveness1, uint64 liveness2) 
{    
    env e;
    bytes claim;
    address asserter;
    address callbackRecipient;
    address escalationManager;
    uint64 liveness;
    address currency = testERC20;
    uint256 bond;
    bytes32 identifier;
    bytes32 domainId;

    require liveness1 != liveness2;
    // Make sure we don't overflow.
    require liveness2 + e.block.timestamp <= max_uint64;

    // Assuming no previous call to assertTruth was made:
    bytes32 ID2 = getId(e,claim,callbackRecipient,escalationManager,liveness2,currency,bond,identifier);
    require getAssertionAsserter(ID2) == 0;
    
    // Here we "force" the combination of parameters to succeed.
    assertTruth(e,claim,asserter,callbackRecipient,escalationManager,
        liveness1,currency,bond,identifier,domainId);

    // Call again, with a different liveness parameter.
    assertTruth@withrevert(e,claim,asserter,callbackRecipient,escalationManager,
        liveness2,currency,bond,identifier,domainId);

    assert !lastReverted;
}

// Verified
rule onlyOneAssertionAtATime(method f, bytes32 assertion, bytes32 other) 
filtered{f -> !f.isView && !isMultiCall(f)} {
    env e;
    calldataarg args;
    // We distinguish between some assertion and 'another' one.
    require other != assertion;

    bool settled_before = getAssertionSettled(assertion);
    bool settledOther_before = getAssertionSettled(other);
    bool resolution_before = getAssertionSettlementResolution(assertion);
    bool resolutionOther_before = getAssertionSettlementResolution(other);
        f(e, args);
    bool settled_after = getAssertionSettled(assertion);
    bool settledOther_after = getAssertionSettled(other);
    bool resolution_after = getAssertionSettlementResolution(assertion);
    bool resolutionOther_after = getAssertionSettlementResolution(other);

    // If some assertion parameter was changed after calling a method,
    // we expect that these parameters must not change for any other assertion.
    assert (settled_before != settled_after || resolution_before != resolution_after)
        =>
        (settledOther_before == settledOther_after && resolutionOther_before == resolutionOther_after);
}
