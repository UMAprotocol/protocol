// SPDX-License-Identifier: MIT
// Copied with no modifications from Polygon demo FxTunnel repo: https://github.com/jdkanani/fx-portal
// except bumping version from 0.7.3 --> 0.8 and changing required `onStateReceive` caller from 
// `0x0000000000000000000000000000000000001001` to an address that is set upon construction. This is to make testing 
// more convenient.
pragma solidity ^0.8.0;

// IStateReceiver represents interface to receive state
interface IStateReceiver {
    function onStateReceive(uint256 stateId, bytes calldata data) external;
}

// IFxMessageProcessor represents interface to process message
interface IFxMessageProcessor {
    function processMessageFromRoot(uint256 stateId, address rootMessageSender, bytes calldata data) external;
}

/**
 * @title FxChild child contract for state receiver
 */
contract FxChildMock is IStateReceiver {
    address public fxRoot;
    address public systemCaller;

    event NewFxMessage(address rootMessageSender, address receiver, bytes data);

    constructor(address _systemCaller) {
        systemCaller = _systemCaller;
    }

    function setFxRoot(address _fxRoot) public {
        require(fxRoot == address(0x0));
        fxRoot = _fxRoot;
    }

    function onStateReceive(uint256 stateId, bytes calldata _data) external override {
        require(msg.sender == systemCaller, "Invalid sender: must be system super user");
        (address rootMessageSender, address receiver, bytes memory data) = abi.decode(_data, (address, address, bytes));
        emit NewFxMessage(rootMessageSender, receiver, data);
        IFxMessageProcessor(receiver).processMessageFromRoot(stateId, rootMessageSender, data);
    }
}