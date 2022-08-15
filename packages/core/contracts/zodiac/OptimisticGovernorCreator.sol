// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./OptimisticGovernor.sol";

/**
 * @title Optimistic Governor Factory Contract
 * @notice Factory contract to create new instances of optimistic governor contracts.
 */
contract OptimisticGovernorCreator {
    event CreatedOptimisticGovernor(OptimisticGovernor optimisticGovernor);

    /**
     * @notice The Optimistic Governor constructor performs validations on input params. These are not repeated in this contract.
     */
    function createOptimisticGovernor(
        address finder,
        address owner,
        address collateral,
        uint256 bondAmount,
        string memory rules,
        bytes32 identifier,
        uint64 liveness
    ) public returns (OptimisticGovernor optimisticGovernor) {
        optimisticGovernor = new OptimisticGovernor(finder, owner, collateral, bondAmount, rules, identifier, liveness);
        emit CreatedOptimisticGovernor(optimisticGovernor);
    }
}
