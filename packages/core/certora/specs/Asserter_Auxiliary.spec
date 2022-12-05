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
filtered{f -> !f.isView && !select_MultiC(f)} {
    env e;
    calldataarg args;
    uint256 bond1 = getAssertionBond(ID);
        f(e, args);
    uint256 bond2 = getAssertionBond(ID);

    assert bond1 == bond2;
}

// Verified
rule onlyOneAssertionAtATime(method f, bytes32 assertion, bytes32 other) 
filtered{f -> !f.isView && !select_MultiC(f)} {
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
