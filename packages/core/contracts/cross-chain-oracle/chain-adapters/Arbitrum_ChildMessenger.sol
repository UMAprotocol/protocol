// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";
import "../../common/implementation/Lockable.sol";
import "../../external/avm/AVM_CrossDomainEnabled.sol";

/**
 * @notice Sends and receives cross chain messages between Arbitrum L2 and Ethereum L1 network.
 * @dev This contract is ownable via the onlyCrossDomainAccount modifier, restricting ownership to the cross-domain
 * parent messenger contract that lives on L1.
 */
contract Arbitrum_ChildMessenger is AVM_CrossDomainEnabled, ChildMessengerInterface, Lockable {
    // The only child network contract that can send messages over the bridge via the messenger is the oracle spoke.
    address public oracleSpoke;

    // Messenger contract on the other side of the L1<->L2 bridge.
    address public parentMessenger;

    event SetOracleSpoke(address newOracleSpoke);
    event SetParentMessenger(address newParentMessenger);
    event MessageSentToParent(bytes data, address indexed parentAddress, address indexed oracleSpoke, uint256 id);
    event MessageReceivedFromParent(bytes data, address indexed targetSpoke, address indexed parentAddress);

    /**
     * @notice Construct the Arbitrum_ChildMessenger contract.
     * @param _parentMessenger The address of the L1 parent messenger. Acts as the "owner" of this contract.
     */
    constructor(address _parentMessenger) {
        parentMessenger = _parentMessenger;
    }

    /**
     * @notice Changes the stored address of the Oracle spoke, deployed on L2.
     * @dev The caller of this function must be the parent messenger, over the canonical bridge.
     * @param newOracleSpoke address of the new oracle spoke, deployed on L2.
     */
    function setOracleSpoke(address newOracleSpoke) public onlyFromCrossDomainAccount(parentMessenger) nonReentrant() {
        oracleSpoke = newOracleSpoke;
        emit SetOracleSpoke(newOracleSpoke);
    }

    /**
     * @notice Changes the stored address of the parent messenger, deployed on L1.
     * @dev The caller of this function must be the parent messenger, over the canonical bridge.
     * @param newParentMessenger address of the new parent messenger, deployed on L1.
     */
    function setParentMessenger(address newParentMessenger)
        public
        onlyFromCrossDomainAccount(parentMessenger)
        nonReentrant()
    {
        parentMessenger = newParentMessenger;
        emit SetParentMessenger(newParentMessenger);
    }

    /**
     * @notice Sends a message to the parent messenger via the canonical message bridge.
     * @dev The caller must be the OracleSpoke on L2. No other contract is permissioned to call this function.
     * @dev The L1 target, the parent messenger, must implement processMessageFromChild to consume the message.
     * @param data data message sent to the L1 messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToParent(bytes memory data) public override nonReentrant() {
        require(msg.sender == oracleSpoke, "Only callable by oracleSpoke");
        bytes memory dataSentToParent = abi.encodeWithSignature("processMessageFromCrossChainChild(bytes)", data);
        uint256 id = sendCrossDomainMessage(msg.sender, parentMessenger, dataSentToParent);
        emit MessageSentToParent(dataSentToParent, parentMessenger, oracleSpoke, id);
    }

    /**
     * @notice Process a received message from the parent messenger via the canonical message bridge.
     * @dev The caller must be the the parent messenger, sent over the canonical message bridge.
     * @param data data message sent from the L1 messenger. Should be an encoded function call or packed data.
     * @param target desired recipient of `data`. Target must implement the `processMessageFromParent` function. Having
     * this as a param enables the L1 Messenger to send messages to arbitrary addresses on the L1. This is primarily
     * used to send messages to the OracleSpoke and GovernorSpoke on L2.
     */
    function processMessageFromCrossChainParent(bytes memory data, address target)
        public
        onlyFromCrossDomainAccount(parentMessenger)
        nonReentrant()
    {
        ChildMessengerConsumerInterface(target).processMessageFromParent(data);
        emit MessageReceivedFromParent(data, target, parentMessenger);
    }
}
