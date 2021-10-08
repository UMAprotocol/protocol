// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./Arbitrum_CrossDomainEnabled.sol";
import "../interfaces/MessengerInterface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Sends cross chain messages Arbitrum L2 network.
 * @dev This contract's owner should be set to the BridgeAdmin deployed on the same L1 network so that only the
 * BridgeAdmin can call cross-chain administrative functions on the L2 DepositBox via this messenger.
 * @dev This address will be the sender of any L1 --> L2 retryable tickets, so it should be set as the cross domain
 * owner for L2 contracts that expect to receive cross domain messages.
 */
contract Arbitrum_Messenger is Ownable, Arbitrum_CrossDomainEnabled, MessengerInterface {
    /**
     * @param _inbox Contract that sends generalized messages to the Arbitrum chain.
     */
    constructor(address _inbox) Arbitrum_CrossDomainEnabled(_inbox) {}

    /**
     * @notice Sends a message to an account on L2.
     * @param target The intended recipient on L2.
     * @param l1CallValue Amount of ETH deposited to `target` contract on L2. Used to pay for L2 submission fee and
     * l2CallValue.
     * @param gasLimit The gasLimit for the receipt of the message on L2.
     * @param gasPrice Gas price bid for L2 execution.
     * @param maxSubmissionCost: Max gas deducted from user's L2 balance to cover base submission fee.
     * This amount is proportional to the size of `data`.
     * @param message The data to send to the target (usually calldata to a function with
     *  `onlyFromCrossDomainAccount()`)
     */
    function relayMessage(
        address target,
        uint256 l1CallValue,
        uint256 gasLimit,
        uint256 gasPrice,
        uint256 maxSubmissionCost,
        bytes memory message
    ) external payable override onlyOwner {
        // Since we know the L2 target's address in advance, we don't need to alias an L1 address.
        sendTxToL2NoAliassing(
            target,
            target, // send any excess ether to the L2 deposit box.
            l1CallValue,
            maxSubmissionCost, // TODO: Determine the max submission cost. From the docs: "current base submission fee is queryable via ArbRetryableTx.getSubmissionPrice"
            gasLimit,
            gasPrice,
            message
        );
    }
}
