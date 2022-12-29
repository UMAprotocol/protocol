// For every new spec you create, import this basic spec file:
import "./Asserter_Base.spec"
import "./dispatchedMethods.spec"

// An ERC20 contract in our scope. One can access its methods or address by
// its alias (testERC20)
using TestnetERC20 as testERC20
/**************************************************
 *      Top Level Properties / Rule Ideas         *
 **************************************************/
 // Prove that the sum of bonds for a specific currency is correlated with the 
 // main contract ERC20 balance. 

methods {
    // Added by Certora: a method to calculate the settlement fee for everty assertion.
    getOracleFeeByAssertion(bytes32) returns (uint256) envfree
}

/**************************************************
 *     Utilities for tracking the sum of bonds    *
 **************************************************/

definition maxAddress() returns address = 0xffffffffffffffffffffffffffffffffffffffff;

 // Ghost: the sum of bonds of all assertions for every ERC20 token.
ghost mapping(address => mathint) sumOfBonds {
    // An initial axiom for post-constructor state only.
    init_state axiom forall address token.
        sumOfBonds[token] == 0;
}
 
// Ghost: tracks the currency token of each assertion by its ID.
ghost mapping(bytes32 => address) assertionToken {
    init_state axiom forall bytes32 assertionID.
        assertionToken[assertionID] == 0;
}

// Hook : copy assertion currency to assertionToken
hook Sload address value assertions[KEY bytes32 assertionID].currency STORAGE 
{
    assertionToken[assertionID] = value & maxAddress();
} 

 // Hook : update sum of bonds per token
hook Sstore assertions[KEY bytes32 assertionID].bond uint256 value (uint256 old_value) STORAGE 
{
    address token = assertionToken[assertionID];
    sumOfBonds[token] = sumOfBonds[token] + value - old_value; 
}

invariant ghostTracksAssertionCurrency(bytes32 assertionID)
    assertionToken[assertionID] == getAssertionCurrency(assertionID)

/**************************************************/

// Verified
invariant validBondPercentage()
    burnedBondPercentage() <= 10^18 && burnedBondPercentage() > 0
    filtered{f -> !isMultiCall(f)}

// Simple integrity rule
rule assertionDisputerIntegrity(address disputer, bytes32 assertionID) {
    env e;
    disputeAssertion(e, assertionID, disputer);
    assert disputer == getAssertionDisputer(assertionID);
}

// When we call settleAssertion, we expect that either the asserter
// or the disputer get the correct amount of bonds.
rule onlyDisputerOrAsserterGetBond(bytes32 assertionID) {
    env e;
    address asserter = getAssertionAsserter(assertionID);
    address disputer = getAssertionDisputer(assertionID);
    address currency = getAssertionCurrency(assertionID);
    uint256 bond =  getAssertionBond(assertionID);
    address other;

    require currency == testERC20;  // A specific instance of the currency

    // 'Other' is none of the addresses involved in the bonds transfer.
    require asserter != other; 
    require disputer != other;
    require store != other;
    require currentContract != other;

    // Assuming the asserter is not the optimistic asserter contract.
    require asserter != currentContract;
    
    // Require zero fees (simplifcation)
    require getOracleFeeByAssertion(assertionID) == 0;

    uint256 asserterBalance1 = tokenBalanceOf(currency, asserter);
    uint256 disputerBalance1 = tokenBalanceOf(currency, disputer);
    uint256 otherBalance1 = tokenBalanceOf(currency, other);

        settleAssertion(e, assertionID);

    uint256 asserterBalance2 = tokenBalanceOf(currency, asserter);
    uint256 disputerBalance2 = tokenBalanceOf(currency, disputer);
    uint256 otherBalance2 = tokenBalanceOf(currency, other);

    // We first verify that no other address gets bonds
    assert otherBalance1 == otherBalance2;
    
    // Now we treat every possible case separately:
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
    else if(disputer == currentContract) {
        bool asserterWins = (asserterBalance2 == asserterBalance1 + 2*bond);
        bool disputerLoses = (disputerBalance1 == disputerBalance2 + 2*bond);
        bool asserterLoses = (asserterBalance2 == asserterBalance1);
        bool disputerWins= (disputerBalance1 == disputerBalance2);
        assert (asserterWins && disputerLoses) || (disputerWins && asserterLoses);
    }
    else {
        bool asserterWins = (asserterBalance2 == asserterBalance1 + 2*bond);
        bool asserterLoses = (asserterBalance2 == asserterBalance1);
        bool disputerWins = (disputerBalance2 == disputerBalance1 + 2*bond);
        bool disputerLoses = (disputerBalance1 == disputerBalance2);
        assert (asserterWins && disputerLoses) || (disputerWins && asserterLoses);
    }
}

// Verified
rule asserterBalanceDecreaseOnlyForSettle(address token, method f) 
filtered{f -> !f.isView && !isMultiCall(f)} {
    env e;
    calldataarg args;
    uint256 asserterBalanceBefore = tokenBalanceOf(token, currentContract);
        f(e, args);
    uint256 asserterBalanceAfter = tokenBalanceOf(token, currentContract);
    assert asserterBalanceBefore > asserterBalanceAfter => isSettle(f);
}

// Verified
rule asserterBalanceDecreaseLimitedByBond(bytes32 assertionId) {
    env e;
    address currency = getAssertionCurrency(assertionId);
    address token; require token != currency;
    uint256 bond = getAssertionBond(assertionId);
    uint256 asserterCurBalanceBefore = tokenBalanceOf(currency, currentContract);
    uint256 asserterTokBalanceBefore = tokenBalanceOf(token, currentContract);

        settleAssertion(e, assertionId);
    
    uint256 asserterCurBalanceAfter = tokenBalanceOf(currency, currentContract);
    uint256 asserterTokBalanceAfter = tokenBalanceOf(token, currentContract);

    assert asserterTokBalanceAfter == asserterTokBalanceBefore;
    assert asserterCurBalanceBefore <= 2*bond + asserterCurBalanceAfter;
}

// Tests our own ghosts : can ignore for now
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
    assert sum1 != sum2 => token == currency2;
}

// A CVL copy implementation of the assertion fee calculation.
function assertionFee(uint256 bond) returns uint256 {
    return to_uint256((burnedBondPercentage()*bond)/(10^18));
}
