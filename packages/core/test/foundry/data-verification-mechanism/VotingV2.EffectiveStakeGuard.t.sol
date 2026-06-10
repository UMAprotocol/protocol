// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

// Mirrors the pre-fix raw subtraction and the post-fix saturating guard used by VotingV2 to compute a voter's
// effective stake for a round (`voterStake.stake - voterStake.pendingStakes[round]`). `_effectiveStake` is an
// `internal pure` helper in VotingV2, so this harness reproduces both forms to lock in the invariant that the guard
// enforces. The guard is defense-in-depth (the production subtraction is kept non-negative by VotingV2's
// update-before-mutate ordering and monotonic request traversal); this test asserts that, should that non-local
// invariant ever be broken, the guard fails closed to the correct value (0) instead of underflowing.
contract EffectiveStakeHarness {
    // Pre-fix behavior: a plain checked subtraction. Reverts on underflow.
    function rawDiff(uint128 stake, uint128 pendingStake) external pure returns (uint128) {
        return stake - pendingStake;
    }

    // Post-fix behavior: identical to VotingV2._effectiveStake.
    function effectiveStake(uint128 stake, uint128 pendingStake) external pure returns (uint128) {
        return stake > pendingStake ? stake - pendingStake : 0;
    }
}

contract VotingV2EffectiveStakeGuardTest is Test {
    EffectiveStakeHarness private harness;

    function setUp() public {
        harness = new EffectiveStakeHarness();
    }

    // 1. No behavior change on the normal path (stake >= pendingStake): the guard equals the raw subtraction. This
    // proves the hardening does not alter vote weighting or slash/reward bases for any reachable state today.
    function test_NormalPath_MatchesRawSubtraction() public {
        assertEq(harness.effectiveStake(1000, 0), harness.rawDiff(1000, 0));
        assertEq(harness.effectiveStake(1000, 400), harness.rawDiff(1000, 400));
        assertEq(harness.effectiveStake(1000, 1000), harness.rawDiff(1000, 1000)); // exactly zero
        assertEq(harness.effectiveStake(1000, 400), 600);
        assertEq(harness.effectiveStake(1000, 1000), 0);
    }

    // 2. Broken-invariant path (pendingStake > stake): the raw subtraction underflows and reverts (a fund-locking
    // DoS: a reverting effective-stake computation bricks reveal/updateTrackers/stake/unstake/withdraw for that
    // voter). The guard instead returns 0, the semantically correct effective participation.
    function test_BrokenInvariant_SaturatesInsteadOfReverting() public {
        vm.expectRevert(stdError.arithmeticError);
        harness.rawDiff(900, 901);

        assertEq(harness.effectiveStake(900, 901), 0);
        assertEq(harness.effectiveStake(0, type(uint128).max), 0);
    }

    // 3. The guard can never inflate a voter's counted weight: the result is always <= stake. This is the
    // anti-inflation property -- the effective stake fed into vote tallying and slash/reward math is bounded by the
    // voter's actual stake regardless of the pendingStakes memo.
    function testFuzz_NeverExceedsStake(uint128 stake, uint128 pendingStake) public {
        uint128 result = harness.effectiveStake(stake, pendingStake);
        assertLe(result, stake);
        if (pendingStake >= stake) assertEq(result, 0);
        else assertEq(result, stake - pendingStake);
    }
}
