// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@eth-optimism/contracts/libraries/bridge/CrossDomainEnabled.sol";
import "../interfaces/ParentMessengerInterface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Sends cross chain messages from Ethereum L1 to Optimism L2 network.
 * @dev This contract's is ownable enabling the OracleHub and GovernorHub to make calls to the L2.
 */
contract Optimism_Messenger is Ownable, OVM_CrossDomainEnabled, MessengerInterface {
    constructor(address _crossDomainMessenger) OVM_CrossDomainEnabled(_crossDomainMessenger) {}

    /**
     * @notice Sends a message to an account on L2.
     * @param target The intended recipient on L2.
     * @param gasLimit The gasLimit for the receipt of the message on L2.
     * @param message The data to send to the target (usually calldata to a function with
     *  `onlyFromCrossDomainAccount()`)
     */
    function sendMessageToChild(
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
