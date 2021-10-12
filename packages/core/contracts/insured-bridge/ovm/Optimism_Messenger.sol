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

    function relayMessage(
        address target,
        address,
        uint256,
        uint256 gasLimit,
        uint256,
        uint256,
        bytes memory message
    ) external payable override onlyOwner {
        sendCrossDomainMessage(target, uint32(gasLimit), message);
    }
}
