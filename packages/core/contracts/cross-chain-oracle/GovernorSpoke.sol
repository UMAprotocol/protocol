// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./interfaces/ChildMessengerConsumerInterface.sol";
import "../common/implementation/Lockable.sol";
import "./SpokeBase.sol";

/**
 * @title Cross-chain Oracle L2 Governor Spoke.
 * @notice Governor contract deployed on L2 that receives governance actions from Ethereum.
 */
contract GovernorSpoke is Lockable, SpokeBase, ChildMessengerConsumerInterface {
    constructor(address _finderAddress) SpokeBase(_finderAddress) {}

    event ExecutedGovernanceTransaction(address indexed to, bytes data);

    /**
     * @notice Executes governance transaction created on Ethereum.
     * @dev Can only be called by ChildMessenger contract that wants to execute governance action on this child chain
     * that originated from DVM voters on root chain. ChildMessenger should only receive communication from
     * ParentMessenger on mainnet. See the SpokeBase for the onlyMessenger modifier.

     * @param data Contains the target address and the encoded function selector + ABI encoded params to include in
     * delegated transaction.
     */
    function processMessageFromParent(bytes memory data) public override nonReentrant() onlyMessenger() {
        (address to, bytes memory inputData) = abi.decode(data, (address, bytes));

        require(_executeCall(to, inputData), "execute call failed");
        emit ExecutedGovernanceTransaction(to, inputData);
    }

    // Note: this snippet of code is copied from Governor.sol.
    function _executeCall(address to, bytes memory data) internal returns (bool) {
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
