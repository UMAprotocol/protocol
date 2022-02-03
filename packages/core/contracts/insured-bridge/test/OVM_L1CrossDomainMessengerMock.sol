pragma solidity ^0.8.0;
import "@eth-optimism/contracts/libraries/bridge/ICrossDomainMessenger.sol";

contract OVM_L1CrossDomainMessengerMock is ICrossDomainMessenger {
    function xDomainMessageSender() external view override returns (address) {
        // Trivial return this contract's address.
        return address(this);
    }

    function sendMessage(
        address _target,
        bytes calldata _message,
        uint32 _gasLimit
    ) external override {}
    // Do nothing.
}
