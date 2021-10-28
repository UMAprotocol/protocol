pragma solidity ^0.8.0;
import "../../external/avm/interfaces/iArbitrum_Inbox.sol";

contract Arbitrum_InboxMock is iArbitrum_Inbox {
    // We leave these unused function parameters named because this contract is used with smockit and makes testing
    // this function's call inputs easier.
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
