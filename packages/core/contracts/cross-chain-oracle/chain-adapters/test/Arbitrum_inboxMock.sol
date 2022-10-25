pragma solidity ^0.8.0;

import "../../../external/avm/interfaces/iArbitrum_Inbox.sol";
import "../../../cross-chain-oracle/chain-adapters/Arbitrum_ParentMessenger.sol";

contract Arbitrum_OutboxMock {
    function l2ToL1Sender() external view returns (address) {
        // Function not called in tests, only smocked.
        return address(this);
    }
}

contract Arbitrum_BridgeMock {
    address public outbox;

    function setOutbox(address _outbox) external {
        outbox = _outbox;
    }

    function activeOutbox() external view returns (address) {
        return outbox;
    }

    // This function can be called by an EOA to send a call to the parent messenger, which is important in tests
    // because `processMessageFromCrossChainChild` can only be called by the Bridge contract.
    function processMessageFromCrossChainChild(address payable messengerToCall, bytes memory data) external {
        Arbitrum_ParentMessenger(messengerToCall).processMessageFromCrossChainChild(data);
    }
}

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
        return 0;
    }

    function bridge() external view returns (address) {
        // Function not called in tests, only smocked.
        return address(this);
    }
}
