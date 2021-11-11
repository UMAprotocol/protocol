// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/ParentMessengerInterface.sol";

contract GovernorHubMock {
    int256 price;
    ParentMessengerInterface messenger;

    event RelayedGovernanceRequest(uint256 chainId, address messenger, address to, bytes data, bytes dataSentToChild);

    function setMessenger(address _messenger) public {
        messenger = ParentMessengerInterface(_messenger);
    }

    function relayGovernance(
        uint256 chainId,
        address to,
        bytes memory data
    ) external {
        bytes memory dataSentToChild = abi.encode(to, data);
        messenger.sendMessageToChild(dataSentToChild);
        emit RelayedGovernanceRequest(chainId, address(messenger), to, data, dataSentToChild);
    }
}
