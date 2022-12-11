import "./Asserter_Base.spec"
using TestnetERC20 as testERC20
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

// Ghost address: assertion currency for invariants
//ghost address invariantCurrency;

// Hook : copy assertion currency to assertionToken
hook Sload address value assertions[KEY bytes32 assertionID].currency STORAGE 
{
    assertionToken[assertionID] = value & maxAddress();
} 

 // Hook : update some of bonds per token
hook Sstore assertions[KEY bytes32 assertionID].bond uint256 value (uint256 old_value) STORAGE 
{
    address token = assertionToken[assertionID];
    require invariantCurrency == token;
    sumOfBonds[token] = sumOfBonds[token] + value - old_value; 
}

invariant ghostTracksAssertionCurrency(bytes32 assertionID)
    assertionToken[assertionID] == getAssertionCurrency(assertionID)

// Verified
invariant validBondPercentage()
    burnedBondPercentage() <= 10^18 && burnedBondPercentage() > 0
    //filtered{f -> !isMultiCall(f)}
    filtered{f -> isAssertTruth(f)}

rule assertionDisputerIntegrity(address disputer, bytes32 assertionID) {
    env e;
    disputeAssertion(e, assertionID, disputer);
    assert disputer == getAssertionDisputer(assertionID);
}

rule onlyDisputerOrAsserterGetBond(bytes32 assertionID) {
    env e;
    address asserter = getAssertionAsserter(assertionID);
    address disputer = getAssertionDisputer(assertionID);
    address currency = getAssertionCurrency(assertionID);
    uint256 bond =  getAssertionBond(assertionID);
    address other;

    require currency == testERC20;
    require asserter != other;
    require disputer != other;
    require store != other;
    require asserter != currentContract;
    require other != currentContract;
    require assertionFee(bond) == 0;

    uint256 asserterBalance1 = tokenBalanceOf(currency, asserter);
    uint256 disputerBalance1 = tokenBalanceOf(currency, disputer);
    uint256 otherBalance1 = tokenBalanceOf(currency, other);

        settleAssertion(e, assertionID);

    uint256 asserterBalance2 = tokenBalanceOf(currency, asserter);
    uint256 disputerBalance2 = tokenBalanceOf(currency, disputer);
    uint256 otherBalance2 = tokenBalanceOf(currency, other);

    if(disputer == 0) {
        bool asserterWins = (asserterBalance2 == asserterBalance1 + bond);
        bool asserterLoses = false;
        bool disputerWins = false;
        bool disputerLoses = true;
        assert (asserterWins && disputerLoses) || (disputerWins && asserterLoses);
    }
    else if(disputer == asserter) {
        bool asserterWins = (asserterBalance2 == asserterBalance1 + 2*bond);
        assert asserterWins;
    }
    else {
        bool asserterWins = (asserterBalance2 == asserterBalance1 + 2*bond);
        bool asserterLoses = (asserterBalance2 == asserterBalance1);
        bool disputerWins = (disputerBalance2 == disputerBalance1 + 2*bond);
        bool disputerLoses = (disputerBalance1 == disputerBalance2);
        assert (asserterWins && disputerLoses) || (disputerWins && asserterLoses);
    }
    
    assert otherBalance1 == otherBalance2;
}


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

function assertionFee(uint256 bond) returns uint256 {
    return to_uint256((burnedBondPercentage()*bond)/(10^18));
}
