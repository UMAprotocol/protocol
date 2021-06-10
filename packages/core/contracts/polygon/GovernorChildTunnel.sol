// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../external/polygon/tunnel/FxBaseChildTunnel.sol";

/**
 * @title Governor contract deployed on sidechain that receives governance actions from Ethereum.
 */
contract GovernorChildTunnel is FxBaseChildTunnel {
    event ExecutedGovernanceTransaction(address indexed to, uint256 value, bytes data);

    constructor(address _fxChild) FxBaseChildTunnel(_fxChild) {}

    /**
     * @notice Executes governance transaction created on Ethereum.
     * @dev The data will be received automatically from the state receiver when the state is synced between Ethereum
     * and Polygon. This will revert if the Root chain sender is not the `fxRootTunnel` contract.
     * @param sender The sender of `data` from the Root chain.
     * @param data ABI encoded params with which to call `_publishPrice`.
     */
    function _processMessageFromRoot(
        uint256, /* stateId */
        address sender,
        bytes memory data
    ) internal override validateSender(sender) {
        // TODO: Where do we get `value` amount of MATIC from if its >0? The sender of this method will be the system
        // super user who we can't assume sends this txn with the correct value.
        (address to, uint256 value, bytes memory inputData) = abi.decode(data, (address, uint256, bytes));

        require(_executeCall(to, value, inputData), "execute call failed");
        emit ExecutedGovernanceTransaction(to, value, inputData);
    }

    // Note: this snippet of code is copied from Governor.sol.
    function _executeCall(
        address to,
        uint256 value,
        bytes memory data
    ) private returns (bool) {
        // Note: this snippet of code is copied from Governor.sol.
        // solhint-disable-next-line max-line-length
        // https://github.com/gnosis/safe-contracts/blob/59cfdaebcd8b87a0a32f87b50fead092c10d3a05/contracts/base/Executor.sol#L23-L31
        // solhint-disable-next-line no-inline-assembly

        bool success;
        assembly {
            let inputData := add(data, 0x20)
            let inputDataSize := mload(data)
            success := call(gas(), to, value, inputData, inputDataSize, 0, 0)
        }
        return success;
    }
}
