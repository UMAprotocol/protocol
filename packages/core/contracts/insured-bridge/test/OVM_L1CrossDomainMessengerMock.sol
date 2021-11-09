pragma solidity ^0.8.0;
import "../../external/ovm/OVM_CrossDomainEnabled.sol";

contract OVM_L1CrossDomainMessengerMock is iOVM_CrossDomainMessenger {
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
