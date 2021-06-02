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
        uint256 bondNotional;
        uint256 highPriceRange;
        uint256 lowPriceRange;
    }

    mapping(address => RangeBondContractForDifferenceParameters) public contractForDifferenceParameters;

    function setContractForDifferenceParameters(
        address contractForDifferenceAddress,
        uint256 bondNotional,
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
        require(
            params.bondNotional == 0 && params.lowPriceRange == 0 && params.highPriceRange == 0,
            "Parameters already set"
        );

        contractForDifferenceParameters[contractForDifferenceAddress] = RangeBondContractForDifferenceParameters({
            bondNotional: bondNotional,
            lowPriceRange: lowPriceRange,
            highPriceRange: highPriceRange
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
        // This represents the value of the long token(range bond holder). This function's method must return a value
        //  between 0 and 1 to be used as a collateralPerPair that allocates collateral between the short and long tokens.
        // We can use the value of the long token to compute the relative distribution between long and short CFD tokens
        // by simply computing longTokenRedeemed using equation above devided by the collateralPerPair of the CFD.
        // NOTE: the equation's second term could be simplified slightly alebraically to have fewer devided and
        // multiplications. However this introduces rounding issues. By keeping it in this form this is avoided.
        // NOTE: the ternary is used over Math.max for the second term to avoid negative numbers.

        uint256 positiveExpiraryPrice = 0;
        if (expiryPrice > 0) positiveExpiraryPrice = uint256(expiryPrice);

        FixedPoint.Unsigned memory longTokensRedeemed =
            FixedPoint
                .Unsigned(
                Math.min(
                    FixedPoint.Unsigned(params.bondNotional).div(FixedPoint.Unsigned(positiveExpiraryPrice)).rawValue,
                    FixedPoint.Unsigned(params.bondNotional).div(FixedPoint.Unsigned(params.lowPriceRange)).rawValue
                )
            )
                .add(
                FixedPoint.Unsigned(positiveExpiraryPrice).isGreaterThan(FixedPoint.Unsigned(params.highPriceRange))
                    ? FixedPoint
                        .Unsigned(params.bondNotional)
                        .divCeil(FixedPoint.Unsigned(params.highPriceRange))
                        .mulCeil(
                        (FixedPoint.Unsigned(positiveExpiraryPrice).sub(FixedPoint.Unsigned(params.highPriceRange)))
                            .divCeil(FixedPoint.Unsigned(positiveExpiraryPrice))
                    )
                    : FixedPoint.Unsigned(0)
            );

        uint256 cfdCollateralPerPair = ContractForDifferenceInterface(msg.sender).collateralPerPair();

        return longTokensRedeemed.div(FixedPoint.Unsigned(cfdCollateralPerPair)).rawValue;
    }
}
