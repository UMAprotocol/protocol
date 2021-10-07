pragma solidity ^0.8.0;
import "../ovm/iOptimism_CrossDomainMessenger.sol";

contract OVM_L1CrossDomainMessengerMock is iOptimism_CrossDomainMessenger {
    function xDomainMessageSender() external view override returns (address) {
        // Triviall return this contract's address.
        return address(this);
    }

    function sendMessage(
        address _target,
        bytes calldata _message,
        uint256 _gasLimit
    ) external override {
        // Do nothing.
    }
}
