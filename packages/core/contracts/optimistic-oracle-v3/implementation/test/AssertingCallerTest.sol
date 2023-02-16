// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../OptimisticOracleV3.sol";

// Test contract used to wrap assertions for integration testing.
contract AssertingCallerTest {
    using SafeERC20 for IERC20;

    OptimisticOracleV3 immutable optimisticOracleV3;

    constructor(OptimisticOracleV3 _optimisticOracleV3) {
        optimisticOracleV3 = _optimisticOracleV3;
    }

    // Wraps the OptimisticOracleV3 assertTruth function by passing msg.sender as the asserter and transferring the bond.
    function assertTruth(
        bytes memory claim,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domainId
    ) public returns (bytes32 assertionId) {
        currency.safeTransferFrom(msg.sender, address(this), bond);
        currency.safeApprove(address(optimisticOracleV3), bond);

        assertionId = optimisticOracleV3.assertTruth(
            claim,
            msg.sender,
            callbackRecipient,
            escalationManager,
            liveness,
            currency,
            bond,
            identifier,
            domainId
        );
    }
}
