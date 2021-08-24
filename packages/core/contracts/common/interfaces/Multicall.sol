// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.5.0;

/**
 * @title interface for MakerDao's Multicall contract.
 * @dev This only contains the methods/events that we use in our contracts or offchain infrastructure.
 */
contract Multicall {
    struct Call {
        address target;
        bytes callData;
    }

    function aggregate(Call[] memory calls) public virtual returns (uint256 blockNumber, bytes[] memory returnData) {}
}
