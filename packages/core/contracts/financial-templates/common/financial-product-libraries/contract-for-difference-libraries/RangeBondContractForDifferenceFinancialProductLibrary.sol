// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./ContractForDifferenceFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

interface ContractForDifferenceInterface {
    function collateralPerPair() external view returns (uint256);
}

contract RangeBondContractForDifferenceFinancialProductLibrary is
    ContractForDifferenceFinancialProductLibrary,
    Lockable
{
    using FixedPoint for FixedPoint.Unsigned;
    using SignedSafeMath for int256;

    struct RangeBondContractForDifferenceParameters {
        uint256 highPriceRange;
        uint256 lowPriceRange;
    }

    mapping(address => RangeBondContractForDifferenceParameters) public contractForDifferenceParameters;

    function setContractForDifferenceParameters(
        address contractForDifferenceAddress,
        uint256 highPriceRange,
        uint256 lowPriceRange
    ) public nonReentrant() {
        require(
            ExpiringContractInterface(contractForDifferenceAddress).expirationTimestamp() != 0,
            "Invalid CFD address"
        );
        require(highPriceRange > lowPriceRange, "Invalid bounds");

        RangeBondContractForDifferenceParameters memory params =
            contractForDifferenceParameters[contractForDifferenceAddress];

        contractForDifferenceParameters[contractForDifferenceAddress] = RangeBondContractForDifferenceParameters({
            highPriceRange: highPriceRange,
            lowPriceRange: lowPriceRange
        });
    }

    function computeExpiraryTokensForCollateral(int256 expiryPrice) public view override returns (uint256) {
        RangeBondContractForDifferenceParameters memory params = contractForDifferenceParameters[msg.sender];

        // A range bond is defined as = Yield Dollar - Put Option + Call option. Numerically this is found using:
        // N = Notional of bond (100)
        // P = price of token
        // T = number of tokens
        // R1 = Low Price Range
        // R2 = High Price Range
        // T = min(N/P,N/R1) + max((N/R2*(P-R2))/P,0)
        // T = [min(max(1/R2,1/P),1/R1)]/R1 [simplified form without N]
        // This represents the value of the long token(range bond holder). This function's method must return a value
        //  between 0 and 1 to be used as a collateralPerPair that allocates collateral between the short and long tokens.
        // We can use the value of the long token to compute the relative distribution between long and short CFD tokens
        // by simply computing longTokenRedeemed using equation above divided by the collateralPerPair of the CFD.

        uint256 positiveExpiryPrice = expiryPrice > 0 ? uint256(expiryPrice) : 0;

        FixedPoint.Unsigned memory expiryPriceInverted =
            FixedPoint.fromUnscaledUint(1).div(FixedPoint.Unsigned(positiveExpiryPrice));

        FixedPoint.Unsigned memory maxPriceInverted =
            FixedPoint.fromUnscaledUint(1).div(FixedPoint.Unsigned(params.highPriceRange));

        FixedPoint.Unsigned memory minPriceInverted =
            FixedPoint.fromUnscaledUint(1).div(FixedPoint.Unsigned(params.lowPriceRange));

        return
            (FixedPoint.min(FixedPoint.max(maxPriceInverted, expiryPriceInverted), minPriceInverted))
                .div(minPriceInverted)
                .rawValue;
    }
}
