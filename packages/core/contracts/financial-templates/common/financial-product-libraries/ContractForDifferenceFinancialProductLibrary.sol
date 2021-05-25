// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "../../../common/implementation/FixedPoint.sol";

abstract contract ContractForDifferenceFinancialProductLibrary {
    using FixedPoint for FixedPoint.Unsigned;

    function expirationTokensForCollateral(int256 expiryPrice) public view returns (uint256) {
        return 5e17;
    }
}
