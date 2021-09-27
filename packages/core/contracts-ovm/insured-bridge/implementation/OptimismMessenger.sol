// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../external/OVM_CrossDomainEnabled.sol";
import "../interfaces/MessengerInterface.sol";

/**
 * @notice Sends cross chain messages Optimism L2 network.
 */
contract OptimismMessenger is OVM_CrossDomainEnabled, MessengerInterface {
    constructor(address _crossDomainMessenger) OVM_CrossDomainEnabled(_crossDomainMessenger) {}

    /**
     * @notice Sends a message to an account on L2.
     * @param target The intended recipient on L2.
     * @param gasLimit The gasLimit for the receipt of the message on L2.
     * @param gasPrice Unused for sending messages to Optimism.
     * @param message The data to send to the target (usually calldata to a function with
     *  `onlyFromCrossDomainAccount()`)
     */
    function relayMessage(
        address target,
        uint256 gasLimit,
        uint256 gasPrice,
        bytes memory message
    ) external override {
        sendCrossDomainMessage(target, uint32(gasLimit), message);
    }
}
