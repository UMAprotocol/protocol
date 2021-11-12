// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "../../common/implementation/AncillaryData.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";

contract OracleSpokeMock is ChildMessengerConsumerInterface {
    ChildMessengerInterface public messenger;

    event PriceRequested(bytes32 identifier, uint256 time, bytes ancillaryData, bytes dataSentToParent, address caller);

    event MessageProcessed(bytes data, address caller);

    constructor(ChildMessengerInterface _messengerAddress) {
        messenger = _messengerAddress;
    }

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public {
        bytes memory dataSentToParent = abi.encode(identifier, time, _stampAncillaryData(ancillaryData, msg.sender));
        messenger.sendMessageToParent(dataSentToParent);

        emit PriceRequested(identifier, time, ancillaryData, dataSentToParent, msg.sender);
    }

    function processMessageFromParent(bytes memory data) public override {
        emit MessageProcessed(data, msg.sender);
    }

    function _stampAncillaryData(bytes memory ancillaryData, address requester) public view returns (bytes memory) {
        return
            AncillaryData.appendKeyValueUint(
                AncillaryData.appendKeyValueAddress(ancillaryData, "childRequester", requester),
                "childChainId",
                block.chainid
            );
    }
}
