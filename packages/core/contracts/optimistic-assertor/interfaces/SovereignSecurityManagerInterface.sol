// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./OptimisticAssertorInterface.sol";

interface SovereignSecurityManagerInterface {
    struct AssertionPolicies {
        bool allowAssertion;
        bool useDvmAsOracle;
        bool useDisputeResolution;
    }

    function getAssertionPolicies(bytes32 assertionId) external view returns (AssertionPolicies memory);

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
