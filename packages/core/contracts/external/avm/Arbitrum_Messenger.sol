// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./Arbitrum_CrossDomainEnabled.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Sends cross chain messages Arbitrum L2 network.
 * @dev This contract's owner should be set to the BridgeAdmin deployed on the same L1 network so that only the
 * BridgeAdmin can call cross-chain administrative functions on the L2 DepositBox via this messenger.
 * @dev This address will be the sender of any L1 --> L2 retryable tickets, so it should be set as the cross domain
 * owner for L2 contracts that expect to receive cross domain messages.
 */
contract Arbitrum_Messenger is Ownable, Arbitrum_CrossDomainEnabled {
    event RelayedMessage(
        address indexed from,
        address indexed to,
        uint256 indexed seqNum,
        address userToRefund,
        uint256 l1CallValue,
        uint256 gasLimit,
        uint256 gasPrice,
        uint256 maxSubmissionCost,
        bytes data
    );

    /**
     * @param _inbox Contract that sends generalized messages to the Arbitrum chain.
     */
    constructor(address _inbox) Arbitrum_CrossDomainEnabled(_inbox) {}

    /**
     * @notice Sends a message to an account on L2. If this message reverts on l2 for any reason it can either be
     * resent on L1, or redeemed on L2 manually. To learn more see how "retryable tickets" work on Arbitrum
     * https://developer.offchainlabs.com/docs/l1_l2_messages#parameters
     * @param target The intended recipient on L2.
     * @param userToRefund User on L2 to refund extra fees to.
     * @param l1CallValue Amount of ETH deposited to `target` contract on L2. Used to pay for L2 submission fee and
     * l2CallValue. This will usually be > 0.
     * @param gasLimit The gasLimit for the receipt of the message on L2.
     * @param gasPrice Gas price bid for L2 execution.
     * @param maxSubmissionCost: Max gas deducted from user's L2 balance to cover base submission fee.
     * This amount is proportional to the size of `data`.
     * @param message The data to send to the target (usually calldata to a function with
     *  `onlyFromCrossDomainAccount()`)
     */
    function relayMessage(
        address target,
        address userToRefund,
        uint256 l1CallValue,
        uint256 gasLimit,
        uint256 gasPrice,
        uint256 maxSubmissionCost,
        bytes memory message
    ) external payable onlyOwner {
        // Since we know the L2 target's address in advance, we don't need to alias an L1 address.
        uint256 seqNumber =
            sendTxToL2NoAliassing(target, userToRefund, l1CallValue, maxSubmissionCost, gasLimit, gasPrice, message);
        emit RelayedMessage(
            msg.sender,
            target,
            seqNumber,
            userToRefund,
            l1CallValue,
            gasLimit,
            gasPrice,
            maxSubmissionCost,
            message
        );
    }
}
