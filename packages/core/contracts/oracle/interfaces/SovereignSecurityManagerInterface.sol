// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../interfaces/OptimisticAssertorInterface.sol";

interface SovereignSecurityManagerInterface {
    function shouldArbitrateViaDvm(OptimisticAssertorInterface.Assertion memory assertion, address txOriginator)
        external
        returns (bool);

    // This should revert if asserter not whitelisted.
    function shouldAllowAssertionAndArbitrationViaDvm(
        OptimisticAssertorInterface.Assertion memory assertion,
        address txOriginator
    ) external returns (bool);

    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) external returns (int256);
}
