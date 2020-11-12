pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../../common/implementation/Testable.sol";


// TODO: refactor this to use an interface file of the ExpiringMultiParty.
interface ExpiringMultiParty {
    function expirationTimestamp() external view returns (uint256);
}

import "./FinancialProductLibrary.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract StructuredNoteFinancialProductLibrary is Testable, FinancialProductLibrary, Ownable {
    mapping(address => FixedPoint.Unsigned) financialProductStrikes;

    constructor(address _timerAddress) public Testable(_timerAddress) {}

    function setFinancialProductStrike(address financialProduct, FixedPoint.Unsigned memory strike) public onlyOwner {
        require(strike.isGreaterThan(0), "Cant set 0 strike");
        require(financialProductStrikes[financialProduct].isEqual(0), "Strike already set");
        financialProductStrikes[financialProduct] = strike;
    }

    function getStrikeForFinancialProduct(address financialProduct) public view returns (FixedPoint.Unsigned memory) {
        return financialProductStrikes[financialProduct];
    }

    // Create a simple price transformation function that scales the input price by the scalar for testing.
    function transformPrice(FixedPoint.Unsigned memory oraclePrice)
        public
        override
        view
        returns (FixedPoint.Unsigned memory)
    {
        FixedPoint.Unsigned memory strike = financialProductStrikes[msg.sender];
        require(strike.isGreaterThan(0), "Caller has no strike");
        // If price request is made before expiry, return 1. This means that we can keep the contract 100% collateralized
        // with 1 WETH pre-expiry, and that disputes pre-expiry are illogical (token is always backed by 1 WETH pre-expiry)
        if (getCurrentTime() < ExpiringMultiParty(msg.sender).expirationTimestamp()) {
            return FixedPoint.fromUnscaledUint(1);
        }
        if (oraclePrice.isLessThan(strike)) {
            return FixedPoint.fromUnscaledUint(1);
        } else {
            // Token expires to be worth strike $ worth of WETH.
            // eg if ETHUSD is $500 and strike is $400, token is redeemable for 400/500 = 0.8 WETH.
            return strike.div(oraclePrice);
        }
    }
}
