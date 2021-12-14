// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./interfaces/ChildMessengerConsumerInterface.sol";
import "./interfaces/OracleSpokeInterface.sol";
import "./interfaces/ChildMessengerInterface.sol";
import "../common/implementation/Lockable.sol";
import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/implementation/Constants.sol";

/**
 * @title Cross-chain Oracle L2 Governor Spoke.
 * @notice Governor contract deployed on L2 that receives governance actions from Ethereum.
 */
contract GovernorSpoke is Lockable, ChildMessengerConsumerInterface {
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
     * @dev Can only be called by ChildMessenger contract that wants to execute governance action on this child chain that
     * originated from DVM voters on root chain. ChildMessenger should only receive communication from ParentMessenger
     * on mainnet.

     * @param data Contains the target address and the encoded function selector + ABI encoded params to include in
     * delegated transaction.
     */
    function processMessageFromParent(bytes memory data) public override nonReentrant() onlyMessenger() {
        (address to, bytes memory inputData) = abi.decode(data, (address, bytes));
        // TODO: Consider calling this via <address>.call(): https://docs.soliditylang.org/en/v0.8.10/units-and-global-variables.html?highlight=low%20level%20call#members-of-address-types
        // to avoid inline assembly.

        // There is a special case if `to` is this contract. If this contract is the target, then we assume that the
        // cross-chain caller is attempting to change the child messenger.
        if (to == address(this)) {
            address newChildMessenger = abi.decode(inputData, (address));
            messenger = ChildMessengerConsumerInterface(newChildMessenger);
            OracleSpokeInterface(finder.getImplementationAddress(OracleInterfaces.OracleSpoke)).setChildMessenger(
                newChildMessenger
            );
            emit SetChildMessenger(address(messenger));
        } else {
            require(_executeCall(to, inputData), "execute call failed");
            emit ExecutedGovernanceTransaction(to, inputData);
        }
    }

    // Note: this snippet of code is copied from Governor.sol.
    function _executeCall(address to, bytes memory data) private returns (bool) {
        // Note: this snippet of code is copied from Governor.sol and modified to not include any "value" field.
        // solhint-disable-next-line no-inline-assembly

        bool success;
        assembly {
            let inputData := add(data, 0x20)
            let inputDataSize := mload(data)
            // Hardcode value to be 0 for relayed governance calls in order to avoid addressing complexity of bridging
            // value cross-chain.
            success := call(gas(), to, 0, inputData, inputDataSize, 0, 0)
        }
        return success;
    }
}
