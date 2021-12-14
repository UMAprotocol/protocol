// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// This should be replaced with a "real" import when Optimism release their new contract versions.
import "@eth-optimism/contracts/libraries/bridge/CrossDomainEnabled.sol";
import "@eth-optimism/contracts/libraries/constants/Lib_PredeployAddresses.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";
import "../../common/implementation/Lockable.sol";

/**
 * @notice Sends cross chain messages from Optimism L2 to Ethereum L1 network.
 * @dev This contract is ownable via the onlyFromCrossDomainAccount. modifier, restricting ownership to the cross-domain
 * parent messenger contract that lives on L1.
 */
contract Optimism_ChildMessenger is CrossDomainEnabled, ChildMessengerInterface, Lockable {
    // The only child network contract that can send messages over the bridge via the messenger is the oracle spoke.
    address public oracleSpoke;

    // Messenger contract on the other side of the L1<->L2 bridge.
    address public parentMessenger;

    // Hard coded default gas limit for L1 transactions.
    uint32 public defaultGasLimit = 5_000_000;

    event SetOracleSpoke(address newOracleSpoke);
    event SetParentMessenger(address newParentMessenger);
    event SetDefaultGasLimit(uint32 newDefaultGasLimit);
    event MessageSentToParent(bytes data, address indexed parentAddress, address oracleSpoke, uint32 gasLimit);
    event MessageReceivedFromParent(bytes data, address indexed targetSpoke, address indexed parentAddress);

    /**
     * @notice Construct the Optimism_ChildMessenger contract.
     * @param _parentMessenger The address of the L1 parent messenger. Acts as the "owner" of this contract.
     */
    constructor(address _parentMessenger) CrossDomainEnabled(Lib_PredeployAddresses.L2_CROSS_DOMAIN_MESSENGER) {
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
     * @notice Changes the default gas limit that is sent along with transactions to Ethereum.
     * @dev The caller of this function must be the parent messenger, over the canonical bridge.
     * @param newDefaultGasLimit the new L1 gas limit to be set.
     */
    function setDefaultGasLimit(uint32 newDefaultGasLimit)
        public
        onlyFromCrossDomainAccount(parentMessenger)
        nonReentrant()
    {
        defaultGasLimit = newDefaultGasLimit;
        emit SetDefaultGasLimit(newDefaultGasLimit);
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
        sendCrossDomainMessage(parentMessenger, defaultGasLimit, dataSentToParent);
        emit MessageSentToParent(dataSentToParent, parentMessenger, oracleSpoke, defaultGasLimit);
    }

    /**
     * @notice Process a received message from the parent messenger via the canonical message bridge.
     * @dev The caller must be the the parent messenger, sent over the canonical message bridge.
     * @param data data message sent from the L1 messenger. Should be an encoded function call or packed data.
     * @param target desired recipient of `data`. Target must implement the `processMessageFromParent` function. Having
     * this as a param enables the L1 Messenger to send messages to arbitrary addresses on the L2. This is primarily
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
