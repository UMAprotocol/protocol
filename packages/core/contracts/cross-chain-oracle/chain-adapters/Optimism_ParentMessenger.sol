// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// This should be replaced with a "real" import when Optimism release their new contract versions.
import "../../external/ovm/OVM_CrossDomainEnabled.sol";
import "../interfaces/ParentMessengerInterface.sol";
import "../interfaces/ParentMessengerConsumerInterface.sol";
import "./ParentMessengerBase.sol";

/**
 * @notice Sends cross chain messages from Ethereum L1 to Optimism L2 network.
 * @dev This contract's is ownable and should be owned by the DVM governor.
 */
contract Optimism_ParentMessenger is OVM_CrossDomainEnabled, ParentMessengerInterface, ParentMessengerBase {
    /**
     * @notice Construct the Optimism_ParentMessenger contract.
     * @param _crossDomainMessenger The address of the Optimism cross domain messenger contract.
     * @param _childChainId The chain id of the Optimism L2 network this messenger should connect to.
     **/
    constructor(address _crossDomainMessenger, uint256 _childChainId)
        OVM_CrossDomainEnabled(_crossDomainMessenger)
        ParentMessengerBase(_childChainId)
    {}

    /**
     * @notice Changes the default gas limit that is sent along with transactions to Optimism.
     * @dev The caller of this function must be the owner. This should be set to the DVM governor.
     * @param newDefaultGasLimit the new L2 gas limit to be set.
     */
    function setDefaultGasLimit(uint32 newDefaultGasLimit) public onlyOwner {
        defaultGasLimit = newDefaultGasLimit;
    }

    /**
     * @notice Sends a message to the child messenger via the canonical message bridge.
     * @dev The caller must be the either the OracleHub or the GovernorHub, deployed on L2. This is to send either a
     * price or initiate a governance action on L2.
     * @dev The recipient of this message is the child messenger. The messenger must implement processMessageFromParent
     * which then forwards the data to the target either the OracleSpoke or the governorSpoke depending on the caller.
     * @param data data message sent to the L2 messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToChild(bytes memory data) public override onlyHubContract() {
        address target = msg.sender == oracleHub ? oracleSpoke : governorSpoke;

        sendCrossDomainMessage(
            childMessenger, // L2 Target
            defaultGasLimit, // L2 Gas limit
            abi.encodeWithSignature("processMessageFromParent(bytes,address)", data, target) // L2 TX to send.
        );
    }

    /**
     * @notice Process a received message from the child messenger via the canonical message bridge.
     * @dev The caller must be the the child messenger, sent over the canonical message bridge.
     * @dev not that only the OracleHub can receive messages from the child messenger. Therefore we can always forward
     * these messages to this contract. The OracleHub must implement processMessageFromChild to handel this message.
     * @param data data message sent from the L2 messenger. Should be an encoded function call or packed data.
     */
    function processMessageFromChild(bytes memory data) public override onlyFromCrossDomainAccount(childMessenger) {
        ParentMessengerConsumerInterface(oracleHub).processMessageFromChild(childChainId, data);
    }
}
