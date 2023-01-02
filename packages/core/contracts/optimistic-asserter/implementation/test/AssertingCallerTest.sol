// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../OptimisticAsserter.sol";

// Test contract used to wrap assertions for integration testing.
contract AssertingCallerTest {
    using SafeERC20 for IERC20;

    OptimisticAsserter immutable optimisticAsserter;

    constructor(OptimisticAsserter _optimisticAsserter) {
        optimisticAsserter = _optimisticAsserter;
    }

    // Wraps the OptimisticAsserter assertTruth function by passing msg.sender as the asserter and transferring the bond.
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
        currency.safeApprove(address(optimisticAsserter), bond);

        assertionId = optimisticAsserter.assertTruth(
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
