// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./ContractForDifferenceFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

contract CallOptionContractForDifferenceFinancialProductLibrary is
    ContractForDifferenceFinancialProductLibrary,
    Lockable
{
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;

    mapping(address => uint256) public contractForDifferenceStrikePrices;

    function setContractForDifferenceParameters(address contractForDifferenceAddress, uint256 strikePrice)
        public
        nonReentrant()
    {
        require(
            ExpiringContractInterface(contractForDifferenceAddress).expirationTimestamp() != 0,
            "Invalid CFD address"
        );
        require(contractForDifferenceStrikePrices[contractForDifferenceAddress] == 0, "Parameters already set");

        contractForDifferenceStrikePrices[contractForDifferenceAddress] = strikePrice;
    }

    function computeExpiraryTokensForCollateral(int256 expiryPrice) public view override returns (uint256) {
        uint256 contractStrikePrice = contractForDifferenceStrikePrices[msg.sender];

        // If the expirary price is less than the strike price then the long options expire worthless (out of the money).
        // Note we do not consider negative expiry prices in this call option implementation.
        if (expiryPrice < 0 || uint256(expiryPrice) < contractStrikePrice)
            return FixedPoint.fromUnscaledUint(0).rawValue;

        // Else, token expires to be worth the fraction of a collateral token that's in the money.
        // eg if ETHUSD is $500 and strike is $400, long token is redeemable for (500-400)/500 = 0.2 WETH (worth $100)
        // and the short token is worth the remaining 0.8. This is strictly < 1, tending to 1 as the expiry tends to infinity.
        return
            (FixedPoint.Unsigned(uint256(expiryPrice)).sub(FixedPoint.Unsigned(contractStrikePrice)))
                .div(FixedPoint.Unsigned(uint256(expiryPrice)))
                .rawValue;
    }
}
