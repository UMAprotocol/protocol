pragma solidity ^0.8.0;
import "../../external/avm/interfaces/iArbitrum_Inbox.sol";

contract Arbitrum_InboxMock is iArbitrum_Inbox {
    // We leave these unused function parameters named because this contract is used with smockit and makes testing
    // this function's call inputs easier.
    function createRetryableTicketNoRefundAliasRewrite(
        address,
        uint256,
        uint256,
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external payable override returns (uint256) {
        return 1;
    }
}
