// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./ContractForDifferenceFinancialProductLibrary.sol";

import "../../../common/implementation/Lockable.sol";

contract LinearContractForDiffrenceFinancialProductLibrary is ContractForDifferenceFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;

    struct LinearContractForDifferenceParameters {
        uint256 upperBound;
        uint256 lowerBound;
    }

    mapping(address => LinearContractForDifferenceParameters) contractForDifferenceParameters;

    function setContractForDifferenceParameters(
        address contractForDifferenceAddress,
        uint256 upperBound,
        uint256 lowerBound
    ) public nonReentrant() {
        require(ExpiringContractInterface(contractForDifferenceAddress).expirationTimestamp() != 0, "Invalid address");
        require(upperBound > lowerBound, "Invalid bounds");
        require(contractForDifferenceParameters[contractForDifferenceAddress].upperBound > 0, "Parameters already set");

        contractForDifferenceParameters[contractForDifferenceAddress] = LinearContractForDifferenceParameters({
            upperBound: upperBound,
            lowerBound: lowerBound
        });
    }

    function expirationTokensForCollateral(uint256 expiryPrice) public view override returns (uint256) {
        LinearContractForDifferenceParameters memory params = contractForDifferenceParameters[msg.sender];

        if (expiryPrice > params.upperBound) return FixedPoint.fromUnscaledUint(1).rawValue;

        if (expiryPrice < params.lowerBound) return FixedPoint.fromUnscaledUint(0).rawValue;

        return FixedPoint.fromUnscaledUint(1).sub(params.upperBound.sub(expiryPrice).div(params.lowerBound)).rawValue;
    }
}
