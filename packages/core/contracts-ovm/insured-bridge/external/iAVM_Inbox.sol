// Copied mostly from https://github.com/makerdao/arbitrum-dai-bridge/blob/7f1b47ef65a43f1696c5f1681109daac127d9c95/contracts/arbitrum/IInbox.sol
// - Bumped solidity version to >= 0.8.x
// - Removed functions from interface that are not used by AVM_CrossDomainEnabled.sol
// - Removed IMessageProvider inheritance.
// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

interface iAVM_Inbox {
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
}
