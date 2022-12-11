import "./Asserter_Base.spec"
/**************************************************
 *      Top Level Properties / Rule Ideas         *
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

rule viewFuncsDontRevert(method f) 
filtered{f -> f.isView} {
    env e;
    require e.msg.value == 0;
    calldataarg args;
    f@withrevert(e, args);

    assert !lastReverted;
}

rule whoChanged_cachedOracle(method f) 
filtered{f -> !f.isView} {
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

// https://vaas-stg.certora.com/output/41958/9099791d156b626ea38e/?anonymousKey=c5fea6951d475b457f652447681442c914946db5
rule whoChanged_assertionCurrency(method f, bytes32 ID)
filtered{f -> isAssertTruth(f)}{
    env e;
    calldataarg args;
    address currency1 = getAssertionCurrency(ID);
        f(e, args);
    address currency2 = getAssertionCurrency(ID);

    assert currency1 == currency2;
}

rule cannotAssertTruthTwiceForSameID() {
    env e1;
    env e2;
    calldataarg args1;
    calldataarg args2;

    bytes32 ID1 = assertTruth(e1, args1);
    bytes32 ID2 = assertTruth(e2, args2);
    assert ID1 != ID2;
}

rule assertTruthSucceedsForEveryLiveness(uint64 liveness1, uint64 liveness2) 
{    
    env e;
    bytes claim;
    address asserter;
    address callbackRecipient;
    address escalationManager;
    uint64 liveness;
    address currency;
    uint256 bond;
    bytes32 identifier;
    bytes32 domainId;

    require liveness1 != liveness2;
    require liveness2 + e.block.timestamp <= max_uint64;
    
    assertTruth(e, claim,asserter,callbackRecipient,escalationManager,
        liveness1,currency,bond,identifier,domainId);

    assertTruth@withrevert(e, claim,asserter,callbackRecipient,escalationManager,
        liveness2,currency,bond,identifier,domainId);

    assert !lastReverted;
}

// Verified
rule onlyOneAssertionAtATime(method f, bytes32 assertion, bytes32 other) 
filtered{f -> !f.isView && !isMultiCall(f)} {
    env e;
    calldataarg args;
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

    assert (settled_before != settled_after || resolution_before != resolution_after)
        =>
        (settledOther_before == settledOther_after && resolutionOther_before == resolutionOther_after);
}
