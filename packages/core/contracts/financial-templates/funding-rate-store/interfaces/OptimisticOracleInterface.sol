// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

interface OptimisticOracle {
    function getLastPrice(bytes32 identifier) external view returns (int256);

    function getPrice(bytes32 identifier, uint256 timestamp) external view returns (int256);

    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        address feeCurrency,
        uint256 proposalFee
    ) external;

    function proposePrice(
        int256 price,
        bytes32 identifier,
        uint256 timestamp
    ) external;
}
