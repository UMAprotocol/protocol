// Copied directly from https://github.com/ethereum-optimism/optimism/blob/7ffb83509c589bd35c2e5f9cb2c6ccbd5f346175/packages/contracts/contracts/optimistic-ethereum/iOVM/bridge/messaging/iOVM_CrossDomainMessenger.sol
// with a change to the solidity version. Old line is commented out for transparency.

// SPDX-License-Identifier: MIT
// pragma solidity >0.5.0 <0.8.0;
pragma solidity ^0.8.0;

/**
 * @title iOVM_CrossDomainMessenger
 */
interface iOVM_CrossDomainMessenger {
    /**********
     * Events *
     **********/

    event SentMessage(bytes message);
    event RelayedMessage(bytes32 msgHash);
    event FailedRelayedMessage(bytes32 msgHash);

    /*************
     * Variables *
     *************/

    function xDomainMessageSender() external view returns (address);

    /********************
     * Public Functions *
     ********************/

    /**
     * Sends a cross domain message to the target messenger.
     * @param _target Target contract address.
     * @param _message Message to send to the target.
     * @param _gasLimit Gas limit for the provided message.
     */
    function sendMessage(
        address _target,
        bytes calldata _message,
        uint32 _gasLimit
    ) external;
}
