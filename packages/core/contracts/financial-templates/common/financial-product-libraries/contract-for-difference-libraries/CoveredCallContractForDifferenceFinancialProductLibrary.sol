// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./ContractForDifferenceFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Covered call Contract For Difference Financial Product Library.
 * @notice Adds settlement logic to create covered call CFDs. The contract will payout a scaled amount of collateral
 * depending on where the settlement price lands relative to the call's strike price. If the settlement is below the
 * strike price then longs expire worthless. If the settlement is above the strike then the payout is the fraction above
 * the strike defined by  (expiryPrice - strikePrice) / expiryPrice. For example, consider a covered call option
 * collateralized in ETH, with a strike a price of 3000.
 * - If the price is less than 3000 then the each long is worth 0 and each short is worth collateralPerPair.
 * - If the price is more than 3000 then each long is worth the fraction of collateralPerPair that was in the money and
 * each short is worth the remaining collateralPerPair.
 * - Say settlement price is 3500.  Then expiryPercentLong = (3500 - 3000) / 3500 = 0.143. The value of this 0.143 ETH
 * is worth 0.143*3500=500 which is the percentage of the collateralPerPair that was above the strike price.
 */
contract CoveredCallContractForDifferenceFinancialProductLibrary is
    ContractForDifferenceFinancialProductLibrary,
    Lockable
{
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;

    mapping(address => uint256) public contractForDifferenceStrikePrices;

    /**
     * @notice Enables any address to set the strike price for an associated CFD.
     * @param contractForDifference address of the CFD.
     * @param strikePrice the strike price for the covered call for the associated CFD.
     * @dev Note: a) Any address can set the initial strike price b) A strike price cannot be 0.
     * c) A strike price can only be set once to prevent the deployer from changing the strike after the fact.
     * d) For safety, a strike price should be set before depositing any synthetic tokens in a liquidity pool.
     * e) financialProduct must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setContractForDifferenceParameters(address contractForDifference, uint256 strikePrice)
        public
        nonReentrant()
    {
        require(ExpiringContractInterface(contractForDifference).expirationTimestamp() != 0, "Invalid CFD address");
        require(contractForDifferenceStrikePrices[contractForDifference] == 0, "Parameters already set");

        contractForDifferenceStrikePrices[contractForDifference] = strikePrice;
    }

    /**
     * @notice Returns a number between 0 and 1 to indicate how much collateral each long and short token are entitled
     * to per collateralPerPair.
     * @param expiryPrice price from the optimistic oracle for the CFD price identifier.
     * @return expiryPercentLong to indicate how much collateral should be sent between long and short tokens.
     */
    function computeExpiryTokensForCollateral(int256 expiryPrice) public view override returns (uint256) {
        uint256 contractStrikePrice = contractForDifferenceStrikePrices[msg.sender];

        // If the expiry price is less than the strike price then the long options expire worthless (out of the money).
        // Note we do not consider negative expiry prices in this call option implementation.
        if (expiryPrice < 0 || uint256(expiryPrice) < contractStrikePrice)
            return FixedPoint.fromUnscaledUint(0).rawValue;

        // Else, token expires to be worth the fraction of a collateral token that's in the money. eg if ETH is $3500
        // and strike is $3000, long token is redeemable for (3500-4000)/3500 = 0.143 WETH which is worth $500 and the
        // short token is worth the remaining 0.8. This is strictly < 1, tending to 1 as the expiry tends to infinity.
        return
            (FixedPoint.Unsigned(uint256(expiryPrice)).sub(FixedPoint.Unsigned(contractStrikePrice)))
                .div(FixedPoint.Unsigned(uint256(expiryPrice)))
                .rawValue;
    }
}
