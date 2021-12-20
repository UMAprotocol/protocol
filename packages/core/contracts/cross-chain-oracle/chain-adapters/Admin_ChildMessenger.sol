// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";
import "../../common/implementation/Lockable.sol";

/**
 * @notice A version of the child messenger that allows an admin to relay messages on its behalf.
 * @dev No parent messenger is needed for this case, as the admin could be trusted to manually send DVM requests on
 * mainnet. This is intended to be used as a "beta" deployment compatible with any EVM-compatible chains before
 * implementing a full bridge adapter. Put simply, it is meant as a stop-gap.
 */
contract Admin_ChildMessenger is Ownable, Lockable, ChildMessengerInterface {
    // The only child network contract that can send messages over the bridge via the messenger is the oracle spoke.
    address public oracleSpoke;

    event SetOracleSpoke(address newOracleSpoke);
    event MessageSentToParent(bytes data, address indexed oracleSpoke);
    event MessageReceivedFromParent(bytes data, address indexed targetSpoke, address indexed caller);

    /**
     * @notice Changes the stored address of the Oracle spoke, deployed on L2.
     * @dev The caller of this function must be the admin.
     * @param newOracleSpoke address of the new oracle spoke, deployed on L2.
     */
    function setOracleSpoke(address newOracleSpoke) public onlyOwner nonReentrant() {
        oracleSpoke = newOracleSpoke;
        emit SetOracleSpoke(newOracleSpoke);
    }

    /**
     * @notice Logs a message to be manually relayed to L1.
     * @dev The caller must be the OracleSpoke on L2. No other contract is permissioned to call this function.
     * @param data data message sent to the L1 messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToParent(bytes memory data) public override nonReentrant() {
        require(msg.sender == oracleSpoke, "Only callable by oracleSpoke");

        // Note: only emit an event. These messages will be manually relayed.
        emit MessageSentToParent(data, oracleSpoke);
    }

    /**
     * @notice Process a received message from the admin.
     * @dev The caller must be the the admin.
     * @param data data message sent from the admin. Should be an encoded function call or packed data.
     * @param target desired recipient of `data`. Target must implement the `processMessageFromParent` function. Having
     * this as a param enables the Admin to send messages to arbitrary addresses from the messenger contract. This is
     * primarily used to send messages to the OracleSpoke and GovernorSpoke.
     */
    function processMessageFromCrossChainParent(bytes memory data, address target) public onlyOwner nonReentrant() {
        ChildMessengerConsumerInterface(target).processMessageFromParent(data);
        emit MessageReceivedFromParent(data, target, msg.sender);
    }
}
