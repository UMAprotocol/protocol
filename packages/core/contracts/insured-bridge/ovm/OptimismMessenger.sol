// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./OVM_CrossDomainEnabled.sol";
import "../interfaces/MessengerInterface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Sends cross chain messages Optimism L2 network.
 * @dev This contract's owner should be set to the BridgeAdmin deployed on the same L1 network so that only the
 * BridgeAdmin can call cross-chain administrative functions on the L2 DepositBox via this messenger.
 */
contract OptimismMessenger is Ownable, OVM_CrossDomainEnabled, MessengerInterface {
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
    ) external override onlyOwner {
        sendCrossDomainMessage(target, uint32(gasLimit), message);
    }
}
