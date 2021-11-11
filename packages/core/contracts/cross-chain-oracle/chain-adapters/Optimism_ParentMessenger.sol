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
     * @param _crossDomainMessenger The address of the Optimsim cross domain messenger contract.
     **/
    constructor(address _crossDomainMessenger, uint256 _chainId)
        OVM_CrossDomainEnabled(_crossDomainMessenger)
        ParentMessengerBase(_chainId)
    {}

    /**
     * @notice Changes the default gas limit that is sent along with transactions to Optimism.
     * @dev The caller of this function must be the owner. This should be set to the DVM governor.
     * @param newDefaultGasLimit the new L2 gas limit to be set.
     */
    function setDefaultGasLimit(uint32 newDefaultGasLimit) public onlyOwner {
        defaultGasLimit = newDefaultGasLimit;
    }

    function sendMessageToChild(bytes memory data) public override onlyPrivilegedCaller() {
        address target = msg.sender == oracleHub ? oracleSpoke : governorSpoke;

        sendCrossDomainMessage(
            childMessenger, // L2 Target
            defaultGasLimit, // L2 Gas limit
            abi.encodeWithSignature("processMessageFromParent(bytes,address)", data, target) // L2 TX to send.
        );
    }

    function processMessageFromChild(bytes memory data) public override onlyFromCrossDomainAccount(oracleSpoke) {
        ParentMessengerConsumerInterface(oracleHub).processMessageFromChild(chainId, data);
    }
}
