// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../external/avm/Arbitrum_Messenger.sol";
import "../interfaces/ParentMessengerInterface.sol";
import "../interfaces/ParentMessengerConsumerInterface.sol";
import "./ParentMessengerBase.sol";
import "../../common/implementation/Lockable.sol";

/**
 * @notice Sends cross chain messages from Ethereum L1 to Arbitrum L2 network.
 * @dev This contract is ownable and should be owned by the DVM governor.
 */
contract Arbitrum_ParentMessenger is Arbitrum_Messenger, ParentMessengerInterface, ParentMessengerBase, Lockable {
    event SetDefaultGasLimit(uint32 newDefaultGasLimit);
    event SetDefaultMaxSubmissionCost(uint256 newMaxSubmissionCost);
    event SetDefaultGasPrice(uint256 newDefaultGasPrice);
    event SetRefundL2Address(address newRefundL2Address);
    event MessageSentToChild(
        bytes data,
        address indexed targetSpoke,
        uint256 l1CallValue,
        uint32 gasLimit,
        uint256 gasPrice,
        uint256 maxSubmissionCost,
        address refundL2Address,
        address indexed childMessenger,
        uint256 sequenceNumber
    );
    event MessageReceivedFromChild(bytes data, address indexed childMessenger, address indexed targetHub);

    // Gas limit for immediate L2 execution attempt (can be estimated via NodeInterface.estimateRetryableTicket).
    // NodeInterface precompile interface exists at L2 address 0x00000000000000000000000000000000000000C8
    uint32 public defaultGasLimit = 5_000_000;

    // Amount of ETH allocated to pay for the base submission fee. The base submission fee is a parameter unique to
    // retryable transactions; the user is charged the base submission fee to cover the storage costs of keeping their
    // ticket’s calldata in the retry buffer. (current base submission fee is queryable via
    // ArbRetryableTx.getSubmissionPrice). ArbRetryableTicket precompile interface exists at L2 address
    // 0x000000000000000000000000000000000000006E.
    uint256 public defaultMaxSubmissionCost = 0.1e18;

    // L2 Gas price bid for immediate L2 execution attempt (queryable via standard eth*gasPrice RPC)
    uint256 public defaultGasPrice = 10e9; // 10 gWei

    // This address on L2 receives extra ETH that is left over after relaying a message via the inbox.
    address public refundL2Address;

    /**
     * @notice Construct the Optimism_ParentMessenger contract.
     * @param _inbox Contract that sends generalized messages to the Arbitrum chain.
     * @param _childChainId The chain id of the Optimism L2 network this messenger should connect to.
     **/
    constructor(address _inbox, uint256 _childChainId) Arbitrum_Messenger(_inbox) ParentMessengerBase(_childChainId) {
        refundL2Address = owner();
    }

    /**
     * @notice Changes the refund address on L2 that receives excess gas or the full msg.value if the retryable
     * ticket reverts.
     * @dev The caller of this function must be the owner, which should be set to the DVM governor.
     * @param newRefundl2Address the new refund address to set. This should be set to an L2 address that is trusted by
     * the owner as it can spend Arbitrum L2 refunds for excess gas when sending transactions on Arbitrum.
     */
    function setRefundL2Address(address newRefundl2Address) public onlyOwner nonReentrant() {
        refundL2Address = newRefundl2Address;
        emit SetRefundL2Address(refundL2Address);
    }

    /**
     * @notice Changes the default gas limit that is sent along with transactions to Arbitrum.
     * @dev The caller of this function must be the owner, which should be set to the DVM governor.
     * @param newDefaultGasLimit the new L2 gas limit to be set.
     */
    function setDefaultGasLimit(uint32 newDefaultGasLimit) public onlyOwner nonReentrant() {
        defaultGasLimit = newDefaultGasLimit;
        emit SetDefaultGasLimit(newDefaultGasLimit);
    }

    /**
     * @notice Changes the default gas price that is sent along with transactions to Arbitrum.
     * @dev The caller of this function must be the owner, which should be set to the DVM governor.
     * @param newDefaultGasPrice the new L2 gas price to be set.
     */
    function setDefaultGasPrice(uint256 newDefaultGasPrice) public onlyOwner nonReentrant() {
        defaultGasPrice = newDefaultGasPrice;
        emit SetDefaultGasPrice(newDefaultGasPrice);
    }

    /**
     * @notice Changes the default max submission cost that is sent along with transactions to Arbitrum.
     * @dev The caller of this function must be the owner, which should be set to the DVM governor.
     * @param newDefaultMaxSubmissionCost the new L2 max submission cost to be set.
     */
    function setDefaultMaxSubmissionCost(uint256 newDefaultMaxSubmissionCost) public onlyOwner nonReentrant() {
        defaultMaxSubmissionCost = newDefaultMaxSubmissionCost;
        emit SetDefaultMaxSubmissionCost(newDefaultMaxSubmissionCost);
    }

    /**
     * @notice Changes the address of the oracle spoke on L2 via the child messenger.
     * @dev The caller of this function must be the owner, which should be set to the DVM governor.
     * @dev This function will only succeed if this contract has enough ETH to cover the approximate L1 call value.
     * @param newOracleSpoke the new oracle spoke address set on L2.
     */
    function setChildOracleSpoke(address newOracleSpoke) public onlyOwner nonReentrant() {
        bytes memory dataSentToChild = abi.encodeWithSignature("setOracleSpoke(address)", newOracleSpoke);
        _sendMessageToChild(dataSentToChild, childMessenger);
    }

    /**
     * @notice Changes the address of the parent messenger on L2 via the child messenger.
     * @dev The caller of this function must be the owner, which should be set to the DVM governor.
     * @dev This function will only succeed if this contract has enough ETH to cover the approximate L1 call value.
     * @param newParentMessenger the new parent messenger contract to be set on L2.
     */
    function setChildParentMessenger(address newParentMessenger) public onlyOwner nonReentrant() {
        bytes memory dataSentToChild = abi.encodeWithSignature("setParentMessenger(address)", newParentMessenger);
        _sendMessageToChild(dataSentToChild, childMessenger);
    }

    /**
     * @notice Sends a message to the child messenger via the canonical message bridge.
     * @dev The caller must be the either the OracleHub or the GovernorHub. This is to send either a
     * price or initiate a governance action to the OracleSpoke or GovernorSpoke on the child network.
     * @dev The recipient of this message is the child messenger. The messenger must implement processMessageFromParent
     * which then forwards the data to the target either the OracleSpoke or the governorSpoke depending on the caller.
     * @dev This function will only succeed if this contract has enough ETH to cover the approximate L1 call value.
     * @param data data message sent to the child messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToChild(bytes memory data) external override onlyHubContract() nonReentrant() {
        address target = msg.sender == oracleHub ? oracleSpoke : governorSpoke;
        bytes memory dataSentToChild =
            abi.encodeWithSignature("processMessageFromCrossChainParent(bytes,address)", data, target);
        _sendMessageToChild(dataSentToChild, target);
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

    /**
     * @notice This function is expected to be queried by Hub contracts that need to determine how much ETH
     * to include in msg.value when calling `sendMessageToChild`.
     * @return Amount of msg.value to include to send cross-chain message.
     */
    function getL1CallValue()
        public
        view
        override(ParentMessengerBase, ParentMessengerInterface)
        nonReentrantView()
        returns (uint256)
    {
        return _getL1CallValue();
    }

    // We need to allow this contract to receive ETH, so that it can include some msg.value amount on external calls
    // to the `sendMessageToChild` function. We shouldn't expect the owner of this contract to send
    // ETH because the owner is intended to be a contract (e.g. the Governor) and we don't want to change the
    // Governor interface.
    fallback() external payable {}

    // Used to determine how much ETH to include in msg.value when calling admin functions like
    // `setChildParentMessenger` and sending messages across the bridge.
    function _getL1CallValue() internal view returns (uint256) {
        // This could overflow if these values are set too high, but since they are configurable by trusted owner
        // we won't catch this case.
        return defaultMaxSubmissionCost + defaultGasPrice * defaultGasLimit;
    }

    // This function will only succeed if this contract has enough ETH to cover the approximate L1 call value.
    function _sendMessageToChild(bytes memory data, address target) internal {
        uint256 requiredL1CallValue = _getL1CallValue();
        require(address(this).balance >= requiredL1CallValue, "Insufficient ETH balance");

        uint256 seqNumber =
            sendTxToL2NoAliassing(
                childMessenger,
                refundL2Address,
                requiredL1CallValue,
                defaultMaxSubmissionCost,
                defaultGasLimit,
                defaultGasPrice,
                data
            );
        emit MessageSentToChild(
            data,
            target,
            requiredL1CallValue,
            defaultGasLimit,
            defaultGasPrice,
            defaultMaxSubmissionCost,
            refundL2Address,
            childMessenger,
            seqNumber
        );
    }
}
