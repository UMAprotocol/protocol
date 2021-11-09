// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../common/implementation/Lockable.sol";
import "./ParentMessengerInterface.sol";

/**
 * @title Governance relayer contract to be deployed on Ethereum that receives messages from the owner (Governor) and
 * sends them to spoke contracts on child chains.
 */
contract GovernorHub is Ownable, Lockable {
    // Associates chain ID with ParentMessenger contract to use to send governance actions to that chain's GovernorSpoke
    // contract.
    mapping(uint256 => ParentMessengerInterface) public messengers;

    event RelayedGovernanceRequest(uint256 indexed chainId, address indexed messenger, address indexed to, bytes data);
    event SetParentMessenger(uint256 indexed chainId, address indexed parentMessenger);

    /**
     * @notice Set new ParentMessenger contract for chainId.
     * @param chainId child network that messenger contract will communicate with.
     * @param messenger ParentMessenger contract that sends messages to ChildMessenger on network with ID `chainId`.
     * @dev Only callable by the owner (presumably the Ethereum Governor contract).
     */
    function setMessenger(uint256 chainId, ParentMessengerInterface messenger) public nonReentrant() onlyOwner {
        require(address(messenger) != address(0), "Invalid messenger contract");
        messengers[chainId] = messenger;
        emit SetParentMessenger(chainId, address(messenger));
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
