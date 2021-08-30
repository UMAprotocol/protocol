// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.5.0;

/**
 * @title interface for MakerDao's Multicall2 contract.
 * @dev This adds method to allow calls within the batch to fail
 * @dev Full implementation can be found here: https://github.com/makerdao/multicall/blob/16ec5e2859b3a4829ceed4ee1ef609e6e9a744ee/src/Multicall2.sol
 */
abstract contract Multicall2 {
    struct Call {
        address target;
        bytes callData;
    }
    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate(Call[] memory calls) public virtual returns (uint256 blockNumber, bytes[] memory returnData);

    function tryBlockAndAggregate(bool requireSuccess, Call[] memory calls)
        public
        virtual
        returns (
            uint256 blockNumber,
            bytes32 blockHash,
            Result[] memory returnData
        );
}
