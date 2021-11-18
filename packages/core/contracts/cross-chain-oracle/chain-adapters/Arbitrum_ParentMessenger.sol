// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../insured-bridge/avm/Arbitrum_CrossDomainEnabled.sol";
import "../interfaces/ParentMessengerInterface.sol";
import "../interfaces/ParentMessengerConsumerInterface.sol";
import "./ParentMessengerBase.sol";
import "../../common/implementation/Lockable.sol";

/**
 * @notice Sends cross chain messages from Ethereum L1 to Arbitrum L2 network.
 * @dev This contract is ownable and should be owned by the DVM governor.
 */
contract Arbitrum_ParentMessenger is
    Arbitrum_CrossDomainEnabled,
    ParentMessengerInterface,
    ParentMessengerBase,
    Lockable
{
    event SetDefaultGasLimit(uint32 newDefaultGasLimit);
    event SetDefaultMaxSubmissionCost(uint256 newMaxSubmissionCost);
    event SetDefaultGasPrice(uint256 newDefaultGasPrice);
    event MessageSentToChild(
        bytes data,
        address indexed targetSpoke,
        uint256 l1CallValue,
        uint32 gasLimit,
        uint256 gasPrice,
        uint256 maxSubmissionCost,
        address indexed childAddress,
        uint256 sequenceNumber
    );
    event MessageReceivedFromChild(bytes data, address indexed childAddress, address indexed targetHub);

    // TODO: Try to read these from Arbitrum system contracts.
    uint32 public defaultGasLimit = 5_000_000;
    uint256 public defaultMaxSubmissionCost = 1e18 / 10; // 0.1e18
    uint256 public defaultGasPrice = 10e9; // 10 gWei

    /**
     * @notice Construct the Optimism_ParentMessenger contract.
     * @param _inbox Contract that sends generalized messages to the Arbitrum chain.
     * @param _childChainId The chain id of the Optimism L2 network this messenger should connect to.
     **/
    constructor(address _inbox, uint256 _childChainId)
        Arbitrum_CrossDomainEnabled(_inbox)
        ParentMessengerBase(_childChainId)
    {}

    /**
     * @notice Changes the default gas limit that is sent along with transactions to Optimism.
     * @dev The caller of this function must be the owner. This should be set to the DVM governor.
     * @param newDefaultGasLimit the new L2 gas limit to be set.
     */
    function setDefaultGasLimit(uint32 newDefaultGasLimit) public onlyOwner nonReentrant() {
        defaultGasLimit = newDefaultGasLimit;
        emit SetDefaultGasLimit(newDefaultGasLimit);
    }

    function setDefaultGasPrice(uint256 newDefaultGasPrice) public onlyOwner nonReentrant() {
        defaultGasPrice = newDefaultGasPrice;
        emit SetDefaultGasPrice(newDefaultGasPrice);
    }

    function setDefaultGasLimit(uint256 newDefaultMaxSubmissionCost) public onlyOwner nonReentrant() {
        defaultMaxSubmissionCost = newDefaultMaxSubmissionCost;
        emit SetDefaultMaxSubmissionCost(newDefaultMaxSubmissionCost);
    }

    // TODO: Add setters for other Arbitrum transaction params.

    /**
     * @notice Sends a message to the child messenger via the canonical message bridge.
     * @dev The caller must be the either the OracleHub or the GovernorHub. This is to send either a
     * price or initiate a governance action to the OracleSpoke or GovernorSpoke on the child network.
     * @dev The recipient of this message is the child messenger. The messenger must implement processMessageFromParent
     * which then forwards the data to the target either the OracleSpoke or the governorSpoke depending on the caller.
     * @param data data message sent to the child messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToChild(bytes memory data) public payable override onlyHubContract() nonReentrant() {
        address target = msg.sender == oracleHub ? oracleSpoke : governorSpoke;
        bytes memory dataSentToChild =
            abi.encodeWithSignature("processMessageFromCrossChainParent(bytes,address)", data, target);

        // Since we know the L2 target's address in advance, we don't need to alias an L1 address.
        uint256 seqNumber =
            sendTxToL2NoAliassing(
                target,
                owner(), // This is the address that will send ETH refunds for any failed messages.
                msg.value, // Pass along all msg.value included by Hub caller.
                defaultGasLimit,
                defaultGasPrice,
                defaultMaxSubmissionCost,
                dataSentToChild
            );
        emit MessageSentToChild(
            dataSentToChild,
            target,
            msg.value,
            defaultGasLimit,
            defaultGasPrice,
            defaultMaxSubmissionCost,
            childMessenger,
            seqNumber
        );
    }

    /**
     * @notice Process a received message from the child messenger via the canonical message bridge.
     * @dev The caller must be the the child messenger, sent over the canonical message bridge.
     * @dev Note that only the OracleHub can receive messages from the child messenger. Therefore we can always forward
     * these messages to this contract. The OracleHub must implement processMessageFromChild to handle this message.
     * @param data data message sent from the child messenger. Should be an encoded function call or packed data.
     */
    function processMessageFromCrossChainChild(bytes memory data)
        public
        onlyFromCrossDomainAccount(childMessenger)
        nonReentrant()
    {
        ParentMessengerConsumerInterface(oracleHub).processMessageFromChild(childChainId, data);
        emit MessageReceivedFromChild(data, childMessenger, oracleHub);
    }
}
