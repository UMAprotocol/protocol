// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./OptimisticAsserterInterface.sol";

interface SovereignSecurityInterface {
    struct AssertionPolicies {
        bool allowAssertion;
        bool useDvmAsOracle;
        bool useDisputeResolution;
        bool validateDisputers;
    }

    function getAssertionPolicy(bytes32 assertionId) external view returns (AssertionPolicies memory);

    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) external view returns (bool);

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
