// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";

import "./ContractForDifferenceFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Linear Contract For Difference Financial Product Library.
 * @notice Adds settlement logic to create linear CFDs. The contract will payout a scaled amount of collateral
 * depending on where the settlement price lands within a price range between an upperBound and a lowerBound. If
 * settlement price is within the price range then the expiryPercentLong is defined by
 * (expiryPrice - lowerBound) / (upperBound - lowerBound). This number represent the amount of collateral from the
 * collateralPerPair that will be sent to the long and short side. If the price is higher than the upperBound then
 * expiryPercentLong = 1. if the price is lower than the lower bound then expiryPercentLong = 0. For example, consider
 * a linear CFD on the price of ETH collateralized in USDC with an upperBound = 4000 and lowerBound = 2000 with a
 * collateralPerPair of 1000 (i.e each pair of long and shorts is worth 1000 USDC). At settlement the expiryPercentLong
 * would =1 (each long worth 1000 and short worth 0) if ETH price was > 4000 and it would be = 0 if < 2000 (each long
 * is worthless and each short is worth 1000). If between the two (say 3500) then expiryPercentLong
 * = (3500 - 2000) / (4000 - 2000) = 0.75. Therefore each long is worth 750 and each short is worth 250.
 */
contract LinearContractForDifferenceFinancialProductLibrary is ContractForDifferenceFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SignedSafeMath for int256;

    struct LinearContractForDifferenceParameters {
        int256 upperBound;
        int256 lowerBound;
    }

    mapping(address => LinearContractForDifferenceParameters) public contractForDifferenceParameters;

    /**
     * @notice Enables any address to set the parameters price for an associated financial product.
     * @param contractForDifference address of the CFD contract.
     * @param upperBound the upper price that the linear CFD will operate within.
     * @param lowerBound the lower price that the linear CFD will operate within.
     * @dev Note: a) Any address can set these parameters b) existing CFD parameters for address not set.
     * c) upperBound > lowerBound.
     * d) parameters price can only be set once to prevent the deployer from changing the parameters after the fact.
     * e) For safety, a parameters should be set before depositing any synthetic tokens in a liquidity pool.
     * f) financialProduct must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setContractForDifferenceParameters(
        address contractForDifference,
        int256 upperBound,
        int256 lowerBound
    ) public nonReentrant() {
        require(ExpiringContractInterface(contractForDifference).expirationTimestamp() != 0, "Invalid CFD address");
        require(upperBound > lowerBound, "Invalid bounds");

        LinearContractForDifferenceParameters memory params = contractForDifferenceParameters[contractForDifference];
        require(params.upperBound == 0 && params.lowerBound == 0, "Parameters already set");

        contractForDifferenceParameters[contractForDifference] = LinearContractForDifferenceParameters({
            upperBound: upperBound,
            lowerBound: lowerBound
        });
    }

    /**
     * @notice Returns a number between 0 and 1 to indicate how much collateral each long and short token are entitled
     * to per collateralPerPair.
     * @param expiryPrice price from the optimistic oracle for the CFD price identifier.
     * @return expiryPercentLong to indicate how much collateral should be sent between long and short tokens.
     */
    function computeExpiryTokensForCollateral(int256 expiryPrice) public view override returns (uint256) {
        LinearContractForDifferenceParameters memory params = contractForDifferenceParameters[msg.sender];

        if (expiryPrice > params.upperBound) return FixedPoint.fromUnscaledUint(1).rawValue;

        if (expiryPrice < params.lowerBound) return FixedPoint.fromUnscaledUint(0).rawValue;

        // if not exceeding bounds, expiryPercentLong = (expiryPrice - lowerBound) / (upperBound - lowerBound)
        return
            FixedPoint
                .Unsigned(uint256(expiryPrice - params.lowerBound))
                .div(FixedPoint.Unsigned(uint256(params.upperBound - params.lowerBound)))
                .rawValue;
    }
}
