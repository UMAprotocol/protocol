// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../common/implementation/Lockable.sol";
import "./RootMessengerInterface.sol";

/**
 * @title Governance relayer contract to be deployed on Ethereum that receives messages from the owner (Governor) and
 * sends them to spoke contracts on sidechains.
 */
contract GovernorHub is Ownable, Lockable {
    // Associates chain ID with RootMessenger contract to use to send governance actions to that chain's GovernorSpoke
    // contract.
    mapping(uint256 => RootMessengerInterface) public messengers;

    event RelayedGovernanceRequest(uint256 indexed chainId, address indexed messenger, address indexed to, bytes data);

    /**
     * @notice Set new Messenger contract for chainId.
     * @param chainId network that messenger contract will communicate with
     * @param messenger RootMessenger contract that sends messages to network with ID `chainId`
     * @dev Only callable by the owner (presumably the Ethereum Governor contract).
     */
    function setMessenger(uint256 chainId, address messenger) public nonReentrant() onlyOwner {
        require(messenger != address(0), "Invalid messenger contract");
        messengers[chainId] = RootMessengerInterface(messenger);
    }

    /**
     * @notice This should be called in order to relay a governance request to the `GovernorSpoke` contract
     * deployed to the child chain associated with `chainId`.
     * @param chainId network that messenger contract will communicate with
     * @param to Contract on child chain to send message to
     * @param data Message to send
     * @dev Only callable by the owner (presumably the Ethereum Governor contract).
     */
    function relayGovernance(
        uint256 chainId,
        address to,
        bytes memory data
    ) external nonReentrant() onlyOwner {
        messengers[chainId].sendMessageToChild(abi.encode(to, data));
        emit RelayedGovernanceRequest(chainId, address(messengers[chainId]), to, data);
    }
}
