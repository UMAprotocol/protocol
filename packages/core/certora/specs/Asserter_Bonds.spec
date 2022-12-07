import "./Asserter_Base.spec"
/**************************************************
 *      Top Level Properties / Rule Ideas         *
 **************************************************/
 // Prove that the sum of bonds for a specific currency is correlated with the 
 // main contract ERC20 balance. 

definition maxAddress() returns address = 0xffffffffffffffffffffffffffffffffffffffff;

 // Ghost: the sum of bonds of all assertions for every ERC20 token.
 ghost mapping(address => mathint) sumOfBonds {
    init_state axiom forall address token.
        sumOfBonds[token] == 0;
 }

// Ghost: tracks the currency token of each assertion by its ID.
ghost mapping(bytes32 => address) assertionToken {
    init_state axiom forall bytes32 assertionID.
        assertionToken[assertionID] == 0;
}

// Hook: reachable
hook Sstore assertions[KEY bytes32 assertionID].currency address value STORAGE 
{
    require value <= maxAddress(); 
    assertionToken[assertionID] = value;
}

/*
// Hook: unreachable
hook Sload address value assertions[KEY bytes32 assertionID].currency STORAGE 
{
    require value <= maxAddress(); 
    assertionToken[assertionID] = value;
} */

 // Hooks
hook Sstore assertions[KEY bytes32 assertionID].bond uint256 value (uint256 old_value) STORAGE 
{
    address token = assertionToken[assertionID];
    sumOfBonds[token] = sumOfBonds[token] + value - old_value; 
}

invariant ghostTracksAssertionCurrency(bytes32 assertionID)
    assertionToken[assertionID] == getAssertionCurrency(assertionID)
    
// Verified
invariant nonZeroBondPercentage()
    burnedBondPercentage() > 0
    filtered{f -> !isMultiCall(f)}

rule testGhosts(bytes32 ID) {
    env e;
    calldataarg args;

    address token;
    uint256 bond1 = getAssertionBond(ID);
    address currency1 = getAssertionCurrency(ID);
    mathint sum1 = sumOfBonds[token];
        bytes32 assertionID = assertTruth(e, args);
    uint256 bond2 = getAssertionBond(ID);
    address currency2 = getAssertionCurrency(ID);
    mathint sum2 = sumOfBonds[token];

    require assertionID == ID;

    assert sum1 != sum2 => sum1 + bond2 - bond1 == to_mathint(sum2);
    assert assertionToken[ID] == currency2;
    assert token == currency2;
} 
