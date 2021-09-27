pragma solidity ^0.8.0;
import "../../external/arbitrum/interfaces/iAVM_Inbox.sol";

contract AVM_InboxMock is iAVM_Inbox {
    function createRetryableTicketNoRefundAliasRewrite(
        address destAddr,
        uint256 l2CallValue,
        uint256 maxSubmissionCost,
        address excessFeeRefundAddress,
        address callValueRefundAddress,
        uint256 maxGas,
        uint256 gasPriceBid,
        bytes calldata data
    ) external payable override returns (uint256) {
        return 1;
    }
}
