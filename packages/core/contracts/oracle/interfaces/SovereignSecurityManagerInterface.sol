// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../interfaces/OptimisticAssertorInterface.sol";

interface SovereignSecurityManagerInterface {
    function shouldArbitrateViaDvm(bytes32 assertionId) external view returns (bool);

    // This should revert if asserter not whitelisted.
    function shouldAllowAssertionAndRespectDvmOnArbitrate(bytes32 assertionId) external returns (bool);

    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) external returns (int256);

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) external;
}
