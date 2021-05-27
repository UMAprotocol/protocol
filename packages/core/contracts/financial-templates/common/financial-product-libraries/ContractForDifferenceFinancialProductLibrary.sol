// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "../../../common/implementation/FixedPoint.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

interface ExpiringContractInterface {
    function expirationTimestamp() external view returns (uint256);
}

abstract contract ContractForDifferenceFinancialProductLibrary {
    function computeExpiraryTokensForCollateral(int256 expiryPrice) public view virtual returns (uint256);
}
