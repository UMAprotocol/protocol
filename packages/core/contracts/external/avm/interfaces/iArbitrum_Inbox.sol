// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

interface IBridge {
    function activeOutbox() external view returns (address);
}

interface iArbitrum_Inbox {
    // Retryable tickets are the Arbitrum protocol’s canonical method for passing generalized messages from Ethereum to
    // Arbitrum. A retryable ticket is an L2 message encoded and delivered by L1; if gas is provided, it will be executed
    // immediately. If no gas is provided or the execution reverts, it will be placed in the L2 retry buffer,
    // where any user can re-execute for some fixed period (roughly one week).
    // Retryable tickets are created by calling Inbox.createRetryableTicket.
    // More details here: https://developer.offchainlabs.com/docs/l1_l2_messages#ethereum-to-arbitrum-retryable-tickets
    function createRetryableTicketNoRefundAliasRewrite(
        address destAddr,
        uint256 l2CallValue,
        uint256 maxSubmissionCost,
        address excessFeeRefundAddress,
        address callValueRefundAddress,
        uint256 maxGas,
        uint256 gasPriceBid,
        bytes calldata data
    ) external payable returns (uint256);

    function bridge() external view returns (address);
}
