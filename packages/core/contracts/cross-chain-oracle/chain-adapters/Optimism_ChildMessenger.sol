// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// This should be replaced with a "real" import when Optimism release their new contract versions.
import "../../external/ovm/OVM_CrossDomainEnabled.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";

/**
 * @notice Sends cross chain messages from Optimism L2 to Ethereum L1 network.
 * @dev This contract's is ownable via the onlyCrossDomainAccount modifier, restricting ownership to the cross-domain
 * parent messenger contract that lives on L1.
 */
contract Optimism_ChildMessenger is OVM_CrossDomainEnabled, ChildMessengerInterface {
    // The only L2 contract that can send messages over the bridge via the messenger is the oracle spoke.
    address public oracleSpoke;

    // Messenger contract on the other side of the L1<->L2 bridge.
    address public parentMessenger;

    // Hard coded default gas limit for L1 transactions.
    uint32 public defaultGasLimit = 5_000_000;

    // TODO: import from optimism contracts when they release their latest version.
    address internal constant L2_CROSS_DOMAIN_MESSENGER = 0x4200000000000000000000000000000000000007;

    event SetOracleSpoke(address newOracleSpoke);
    event SetParentMessenger(address newParentMessenger);
    event SetDefaultGasLimit(uint32 newDefaultGasLimit);
    event MessageSentToParent(bytes data, address indexed parentAddress, uint32 gasLimit);
    event MessageReceivedFromParent(bytes data, address indexed parentAddress);

    /**
     * @notice Construct the Optimism_ChildMessenger contract.
     * @param _parentMessenger The address of the L1 parent messenger. Acts as the "owner" of this contract.
     */
    constructor(address _parentMessenger) OVM_CrossDomainEnabled(L2_CROSS_DOMAIN_MESSENGER) {
        parentMessenger = _parentMessenger;
    }

    /**
     * @notice Changes the stored address of the Oracle spoke, deployed on L2.
     * @dev The caller of this function must be the parent messenger, over the canonical bridge.
     * @param newOracleSpoke address of the new oracle spoke, deployed on L2.
     */
    function setOracleSpoke(address newOracleSpoke) public onlyFromCrossDomainAccount(parentMessenger) {
        oracleSpoke = newOracleSpoke;
        emit SetOracleSpoke(newOracleSpoke);
    }

    /**
     * @notice Changes the stored address of the parent messenger, deployed on L1.
     * @dev The caller of this function must be the parent messenger, over the canonical bridge.
     * @param newParentMessenger address of the new parent messenger, deployed on L1.
     */
    function setParentMessenger(address newParentMessenger) public onlyFromCrossDomainAccount(parentMessenger) {
        parentMessenger = newParentMessenger;
        emit SetParentMessenger(newParentMessenger);
    }

    /**
     * @notice Changes the default gas limit that is sent along with transactions to Ethereum.
     * @dev The caller of this function must be the parent messenger, over the canonical bridge.
     * @param newDefaultGasLimit the new L1 gas limit to be set.
     */
    function setDefaultGasLimit(uint32 newDefaultGasLimit) public onlyFromCrossDomainAccount(parentMessenger) {
        defaultGasLimit = newDefaultGasLimit;
        emit SetDefaultGasLimit(newDefaultGasLimit);
    }

    /**
     * @notice Sends a message to the parent messenger via the canonical message bridge.
     * @dev The caller must be the OracleSpoke on L2. No other contract is permissioned to call this function.
     * @dev The L1 target, the parent messenger, must implement processMessageFromChild to consume the message.
     * @param data data message sent to the L1 messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToParent(bytes memory data) public override {
        require(msg.sender == oracleSpoke, "Only callable by oracleSpoke");
        bytes memory dataSentToParent = abi.encodeWithSignature("processMessageFromChild(bytes)", data);
        sendCrossDomainMessage(parentMessenger, defaultGasLimit, dataSentToParent);
        emit MessageSentToParent(dataSentToParent, parentMessenger, defaultGasLimit);
    }

    /**
     * @notice Process a received message from the parent messenger via the canonical message bridge.
     * @dev The caller must be the the parent messenger, sent over the canonical message bridge.
     * @param data data message sent from the L1 messenger. Should be an encoded function call or packed data.
     * @param target desired recipient of `data`. Target must implement the `processMessageFromParent` function. Having
     * this as a param enables the L1 Messenger to send messages to arbitrary addresses on the L1. This is primarily
     * used to send messages to the OracleSpoke and GovernorSpoke on L2.
     */
    function processMessageFromParent(bytes memory data, address target)
        public
        override
        onlyFromCrossDomainAccount(parentMessenger)
    {
        ChildMessengerConsumerInterface(target).processMessageFromParent(data);
        emit MessageReceivedFromParent(data, target);
    }
}
