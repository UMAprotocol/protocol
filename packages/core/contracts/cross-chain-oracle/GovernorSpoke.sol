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
     * @param data ABI encoded params to include in delegated transaction.
     */
    function processMessageFromParent(bytes memory data) public nonReentrant() onlyMessenger() {
        (address to, bytes memory inputData) = abi.decode(data, (address, bytes));
        require(_executeCall(to, inputData), "execute call failed");
        emit ExecutedGovernanceTransaction(to, inputData);
    }

    // Note: this snippet of code is copied from Governor.sol.
    function _executeCall(address to, bytes memory data) private returns (bool) {
        // Note: this snippet of code is copied from Governor.sol.
        // solhint-disable-next-line max-line-length
        // https://github.com/gnosis/safe-contracts/blob/59cfdaebcd8b87a0a32f87b50fead092c10d3a05/contracts/base/Executor.sol#L23-L31
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
