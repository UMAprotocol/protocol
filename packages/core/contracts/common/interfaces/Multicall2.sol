// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.5.0;

contract Multicall2 {
    struct Call {
        address target;
        bytes callData;
    }
    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate(Call[] memory calls) public virtual returns (uint256 blockNumber, bytes[] memory returnData) {}

    function tryBlockAndAggregate(bool requireSuccess, Call[] memory calls) public returns (uint256 blockNumber, bytes32 blockHash, Result[] memory returnData) {}
}
