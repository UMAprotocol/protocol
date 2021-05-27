// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";

import "./ContractForDifferenceFinancialProductLibrary.sol";
import "../../../common/implementation/Lockable.sol";

contract LinearContractForDiffrenceFinancialProductLibrary is ContractForDifferenceFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SignedSafeMath for int256;

    struct LinearContractForDifferenceParameters {
        int256 upperBound;
        int256 lowerBound;
    }

    mapping(address => LinearContractForDifferenceParameters) contractForDifferenceParameters;

    function setContractForDifferenceParameters(
        address contractForDifferenceAddress,
        int256 upperBound,
        int256 lowerBound
    ) public nonReentrant() {
        require(ExpiringContractInterface(contractForDifferenceAddress).expirationTimestamp() != 0, "Invalid address");
        require(upperBound > lowerBound, "Invalid bounds");

        LinearContractForDifferenceParameters memory params =
            contractForDifferenceParameters[contractForDifferenceAddress];
        require(params.upperBound != 0 || params.lowerBound != 0, "Parameters already set");

        contractForDifferenceParameters[contractForDifferenceAddress] = LinearContractForDifferenceParameters({
            upperBound: upperBound,
            lowerBound: lowerBound
        });
    }

    function computeExpiraryTokensForCollateral(int256 expiryPrice) public view override returns (uint256) {
        LinearContractForDifferenceParameters memory params = contractForDifferenceParameters[msg.sender];

        if (expiryPrice > params.upperBound) return FixedPoint.fromUnscaledUint(1).rawValue;

        if (expiryPrice < params.lowerBound) return FixedPoint.fromUnscaledUint(0).rawValue;

        // if not exceeding bounds, collateralPerToken = (expiryPrice - lower) / (upper - lower)
        return
            FixedPoint
                .Unsigned(uint256(expiryPrice - params.lowerBound))
                .div(FixedPoint.Unsigned(uint256(params.upperBound - params.lowerBound)))
                .rawValue;
    }
}
