// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../OracleHub.sol";
import "../OracleSpoke.sol";
import "../interfaces/ParentMessengerInterface.sol";

/**
 * @notice Can be used as either a Parent or Child messenger mock in unit tests for the Oracle Hub and Spoke
 * cross-chain contracts. The reason that this can't also be used for the Governor Hub and Spoke is that the
 * sendMessageToChild is called with different encoded data in the Oracle versus the Governor.
 */
contract OracleMessengerMock is ParentMessengerInterface {
    bytes public latestAncillaryData;
    uint256 public latestTime;
    bytes32 public latestIdentifier;
    int256 public latestPrice;

    uint256 public messageCount;

    // OracleHub calls `sendMessageToChild`
    function sendMessageToChild(bytes memory data) external override {
        (latestIdentifier, latestTime, latestAncillaryData, latestPrice) = abi.decode(
            data,
            (bytes32, uint256, bytes, int256)
        );
        messageCount++;
    }

    function getL1CallValue() public pure override returns (uint256) {
        return 0;
    }

    // This calls `processMessageFromChild` on OracleHub
    function requestPrice(
        address oracleHub,
        uint256 chainId,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) external {
        OracleHub(oracleHub).processMessageFromChild(chainId, abi.encode(identifier, time, ancillaryData));
    }

    // OracleSpoke calls `sendMessageToParent`
    function sendMessageToParent(bytes memory data) external {
        (latestIdentifier, latestTime, latestAncillaryData) = abi.decode(data, (bytes32, uint256, bytes));
        messageCount++;
    }

    // This calls `processMessageFromParent` on OracleSpoke
    function publishPrice(
        address oracleSpoke,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) external {
        OracleSpoke(oracleSpoke).processMessageFromParent(abi.encode(identifier, time, ancillaryData, price));
    }
}
