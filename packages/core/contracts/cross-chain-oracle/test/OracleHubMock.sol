// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/ParentMessengerConsumerInterface.sol";
import "../interfaces/ParentMessengerInterface.sol";

contract OracleHubMock is ParentMessengerConsumerInterface {
    int256 price;
    ParentMessengerInterface messenger;

    event MessageProcessed(uint256 chainId, bytes data, address caller);
    event PricePublished(
        uint256 chainId,
        bytes32 identifier,
        uint256 time,
        bytes ancillaryData,
        bytes dataSentToChild,
        address caller
    );

    function setMessenger(address _messenger) public {
        messenger = ParentMessengerInterface(_messenger);
    }

    function setPrice(int256 _price) public {
        price = _price;
    }

    function publishPrice(
        uint256 chainId,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public {
        bytes memory dataToSendToChild = abi.encode(identifier, time, ancillaryData, price);
        messenger.sendMessageToChild(dataToSendToChild);
        emit PricePublished(chainId, identifier, time, ancillaryData, dataToSendToChild, msg.sender);
    }

    function processMessageFromChild(uint256 chainid, bytes memory data) public override {
        emit MessageProcessed(chainid, data, msg.sender);
    }
}
