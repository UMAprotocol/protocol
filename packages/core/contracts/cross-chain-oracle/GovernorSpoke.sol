// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./ChildMessengerInterface.sol";
import "../common/implementation/Lockable.sol";

/**
 * @title Governor contract deployed on sidechain that receives governance actions from Ethereum.
 */
contract GovernorSpoke is Lockable {
    // Messenger contract that receives messages from root chain.
    ChildMessengerInterface public messenger;

    event ExecutedGovernanceTransaction(address indexed to, bytes data);
    event SetChildMessenger(address indexed childMessenger);

    constructor(ChildMessengerInterface _messengerAddress) {
        messenger = _messengerAddress;
        emit SetChildMessenger(address(messenger));
    }

    modifier onlyMessenger() {
        require(msg.sender == address(messenger), "Caller must be messenger");
        _;
    }

    /**
     * @notice Executes governance transaction created on Ethereum.
     * @dev Can only called by ChildMessenger contract that wants to execute governance action on this child chain that
     * originated from DVM voters on root chain. ChildMessenger should only receive communication from ParentMessenger
     * on mainnet.
     * @param data Contains the target address and the encoded function selector + ABI encoded params to include in
     * delegated transaction.
     */
    function processMessageFromParent(bytes memory data) public nonReentrant() onlyMessenger() {
        (address to, bytes memory inputData) = abi.decode(data, (address, bytes));
        require(to.call(data), "execute call failed");
        emit ExecutedGovernanceTransaction(to, inputData);
    }
}
