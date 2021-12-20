// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../common/implementation/Lockable.sol";
import "../common/implementation/MultiCaller.sol";
import "./interfaces/ParentMessengerInterface.sol";
import "./GovernorSpoke.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Cross-chain Oracle L1 Governor Hub.
 * @notice Governance relayer contract to be deployed on Ethereum that receives messages from the owner (Governor) and
 * sends them to spoke contracts on child chains.
 */

contract GovernorHub is Ownable, Lockable, MultiCaller {
    // Associates chain ID with ParentMessenger contract to use to send governance actions to that chain's GovernorSpoke
    // contract.
    mapping(uint256 => ParentMessengerInterface) public messengers;

    event RelayedGovernanceRequest(
        uint256 indexed chainId,
        address indexed messenger,
        GovernorSpoke.Call[] calls,
        bytes dataSentToChild
    );
    event SetParentMessenger(uint256 indexed chainId, address indexed parentMessenger);

    /**
     * @notice Set new ParentMessenger contract for chainId.
     * @param chainId child network that messenger contract will communicate with.
     * @param messenger ParentMessenger contract that sends messages to ChildMessenger on network with ID `chainId`.
     * @dev Only callable by the owner (presumably the Ethereum Governor contract).
     */
    function setMessenger(uint256 chainId, ParentMessengerInterface messenger) public nonReentrant() onlyOwner {
        messengers[chainId] = messenger;
        emit SetParentMessenger(chainId, address(messenger));
    }

    /**
     * @notice This should be called in order to relay a governance request to the `GovernorSpoke` contract deployed to
     * the child chain associated with `chainId`.
     * @param chainId network that messenger contract will communicate with
     * @param calls the calls to be made by the GovernorSpoke. Should encode a `to` and `data` prop for each call.
     * @dev Only callable by the owner (presumably the UMA DVM Governor contract, on L1 Ethereum).
     */
    function relayGovernance(uint256 chainId, GovernorSpoke.Call[] memory calls) external nonReentrant() onlyOwner {
        bytes memory dataSentToChild = abi.encode(calls);
        messengers[chainId].sendMessageToChild(dataSentToChild);
        emit RelayedGovernanceRequest(chainId, address(messengers[chainId]), calls, dataSentToChild);
    }
}
