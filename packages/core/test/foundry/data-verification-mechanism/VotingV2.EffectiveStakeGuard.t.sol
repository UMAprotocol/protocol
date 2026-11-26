// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../fixtures/common/CommonTestBase.sol";
import "../fixtures/dvm/BaseDvmFixture.sol";
import "../../../contracts/data-verification-mechanism/implementation/VotingV2.sol";
import "../../../contracts/data-verification-mechanism/implementation/VotingToken.sol";
import "../../../contracts/data-verification-mechanism/implementation/Registry.sol";
import "../../../contracts/data-verification-mechanism/implementation/FixedSlashSlashingLibrary.sol";

// Exposes VotingV2._effectiveStake directly alongside the pre-fix raw subtraction and a test-only mutator to
// simulate a broken pendingStakes invariant on a live VotingV2 instance.
contract EffectiveStakeHarness is VotingV2 {
    constructor(
        uint128 _emissionRate,
        uint64 _unstakeCoolDown,
        uint64 _phaseLength,
        uint32 _maxRolls,
        uint32 _maxRequestsPerRound,
        uint128 _gat,
        uint64 _spat,
        address _votingToken,
        address _finder,
        address _slashingLibrary,
        address _previousVotingContract
    )
        VotingV2(
            _emissionRate,
            _unstakeCoolDown,
            _phaseLength,
            _maxRolls,
            _maxRequestsPerRound,
            _gat,
            _spat,
            _votingToken,
            _finder,
            _slashingLibrary,
            _previousVotingContract
        )
    {}

    // Pre-fix behavior: a plain checked subtraction. Reverts on underflow.
    function rawDiff(uint128 stake, uint128 pendingStake) external pure returns (uint128) {
        return stake - pendingStake;
    }

    // Post-fix behavior: delegates directly to VotingV2._effectiveStake.
    function effectiveStake(uint128 stake, uint128 pendingStake) external pure returns (uint128) {
        return _effectiveStake(stake, pendingStake);
    }

    // Simulates pendingStakes[roundId] exceeding stake so contract-level tests can exercise both VotingV2 call sites
    // under the broken-invariant condition.
    function incrementPendingStakeForTest(
        address voter,
        uint32 roundId,
        uint128 amount
    ) external {
        _incrementPendingStake(voter, roundId, amount);
    }
}

contract VotingV2EffectiveStakeGuardTest is CommonTestBase {
    uint64 private constant PHASE_LENGTH = 86400;
    uint128 private constant ACCOUNT1_STAKE = 300e18;
    uint128 private constant ACCOUNT2_STAKE = 250e18;
    int256 private constant ACCOUNT1_PRICE = 1e18;
    int256 private constant ACCOUNT2_PRICE = 2e18;
    int256 private constant ACCOUNT1_SALT = 111;
    int256 private constant ACCOUNT2_SALT = 222;
    bytes32 private constant IDENTIFIER = bytes32("YES_OR_NO_QUERY");
    bytes private constant ANCILLARY_DATA = bytes("effective-stake-guard-test");
    address private constant REGISTERED_REQUESTER = address(0x100);

    EffectiveStakeHarness private harness;
    VotingToken private votingToken;
    uint256 private requestTime;

    event VoteRevealed(
        address indexed voter,
        address indexed caller,
        uint32 roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price,
        uint128 numTokens
    );

    event VoterSlashed(address indexed voter, uint256 indexed requestIndex, int128 slashedTokens);

    function setUp() public {
        // Start cleanly at the beginning of a Commit phase with a past timestamp available for price requests.
        vm.warp(10 * 2 * uint256(PHASE_LENGTH));

        BaseDvmFixture.BaseDvmContracts memory dvm = new BaseDvmFixture().setUp();

        vm.startPrank(TestAddress.owner);
        Registry registry = new Registry();
        registry.addMember(uint256(Registry.Roles.ContractCreator), TestAddress.owner);
        registry.registerContract(new address[](0), REGISTERED_REQUESTER);
        dvm.finder.changeImplementationAddress(OracleInterfaces.Registry, address(registry));
        dvm.identifierWhitelist.addSupportedIdentifier(IDENTIFIER);

        votingToken = new VotingToken();
        votingToken.addMinter(TestAddress.owner);
        votingToken.mint(TestAddress.account1, 1000e18);
        votingToken.mint(TestAddress.account2, 1000e18);

        FixedSlashSlashingLibrary slashingLibrary = new FixedSlashSlashingLibrary(0.1e18, 0.1e18);

        // GAT = 100e18 (< totalSupply), SPAT = 40% (cumulativeStake = 550e18 => minAgreement = 220e18).
        harness = new EffectiveStakeHarness(
            0,
            0,
            PHASE_LENGTH,
            2,
            100,
            100e18,
            0.4e18,
            address(votingToken),
            address(dvm.finder),
            address(slashingLibrary),
            address(0)
        );
        dvm.finder.changeImplementationAddress(OracleInterfaces.Oracle, address(harness));
        vm.stopPrank();
    }

    // 1. No behavior change on the normal path (stake >= pendingStake): the guard equals the raw subtraction. This
    // proves the hardening does not alter vote weighting or slash/reward bases for any reachable state today.
    function test_NormalPath_MatchesRawSubtraction() public view {
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
    function testFuzz_NeverExceedsStake(uint128 stake, uint128 pendingStake) public view {
        uint128 result = harness.effectiveStake(stake, pendingStake);
        assertLe(result, stake);
        if (pendingStake >= stake) assertEq(result, 0);
        else assertEq(result, stake - pendingStake);
    }

    // 4. Contract-level revealVote test: if pendingStakes[roundId] > stake when revealVote executes, account1 can
    // still reveal without reverting and contributes 0 effective stake while account2 resolves the request.
    function test_RevealVote_BrokenInvariant_SaturatesWeightInsteadOfReverting() public {
        uint32 roundId = _setupActiveRoundAndCommitTwoVotes();

        // Advance to Reveal and push account1's pendingStakes[roundId] above their stake.
        vm.warp(block.timestamp + PHASE_LENGTH);
        assertEq(uint256(harness.getVotePhase()), uint256(VotingV2Interface.Phase.Reveal));

        harness.incrementPendingStakeForTest(TestAddress.account1, roundId, ACCOUNT1_STAKE + 1);
        assertGt(harness.getVoterPendingStake(TestAddress.account1, roundId), ACCOUNT1_STAKE);

        vm.expectEmit(true, true, true, true, address(harness));
        emit VoteRevealed(
            TestAddress.account1,
            TestAddress.account1,
            roundId,
            IDENTIFIER,
            requestTime,
            ANCILLARY_DATA,
            ACCOUNT1_PRICE,
            0
        );
        vm.prank(TestAddress.account1);
        harness.revealVote(IDENTIFIER, requestTime, ACCOUNT1_PRICE, ANCILLARY_DATA, ACCOUNT1_SALT);

        vm.expectEmit(true, true, true, true, address(harness));
        emit VoteRevealed(
            TestAddress.account2,
            TestAddress.account2,
            roundId,
            IDENTIFIER,
            requestTime,
            ANCILLARY_DATA,
            ACCOUNT2_PRICE,
            ACCOUNT2_STAKE
        );
        vm.prank(TestAddress.account2);
        harness.revealVote(IDENTIFIER, requestTime, ACCOUNT2_PRICE, ANCILLARY_DATA, ACCOUNT2_SALT);

        // Advance past the round end: even though account1 staked more than account2, account1 contributed 0 weight,
        // so account2's vote resolves the request.
        vm.warp(harness.getRoundEndTime(roundId));
        vm.prank(REGISTERED_REQUESTER);
        assertEq(harness.getPrice(IDENTIFIER, requestTime, ANCILLARY_DATA), ACCOUNT2_PRICE);
    }

    // 5. Contract-level _updateAccountSlashingTrackers test: once a round resolves while pendingStakes[roundId] > stake,
    // updateTrackers and requestUnstake do not revert on underflow and account1's stake remains withdrawable.
    function test_UpdateTrackers_BrokenInvariant_DoesNotLockStake() public {
        uint32 roundId = _setupActiveRoundAndCommitTwoVotes();

        vm.warp(block.timestamp + PHASE_LENGTH);
        harness.incrementPendingStakeForTest(TestAddress.account1, roundId, ACCOUNT1_STAKE + 1);

        vm.prank(TestAddress.account1);
        harness.revealVote(IDENTIFIER, requestTime, ACCOUNT1_PRICE, ANCILLARY_DATA, ACCOUNT1_SALT);

        vm.prank(TestAddress.account2);
        harness.revealVote(IDENTIFIER, requestTime, ACCOUNT2_PRICE, ANCILLARY_DATA, ACCOUNT2_SALT);

        // Move to the next round so the price request is resolvable during updateTrackers.
        vm.warp(harness.getRoundEndTime(roundId));

        vm.expectEmit(true, true, false, true, address(harness));
        emit VoterSlashed(TestAddress.account1, 0, 0);
        harness.updateTrackers(TestAddress.account1);

        (uint128 stakeAfterUpdate, , , , , uint64 nextIndexToProcess, , ) = harness.voterStakes(TestAddress.account1);
        assertEq(nextIndexToProcess, 1);
        assertEq(stakeAfterUpdate, ACCOUNT1_STAKE);

        uint256 balanceBefore = votingToken.balanceOf(TestAddress.account1);
        vm.startPrank(TestAddress.account1);
        harness.requestUnstake(ACCOUNT1_STAKE);
        harness.executeUnstake();
        vm.stopPrank();

        assertEq(votingToken.balanceOf(TestAddress.account1), balanceBefore + ACCOUNT1_STAKE);
    }

    function _setupActiveRoundAndCommitTwoVotes() internal returns (uint32 roundId) {
        vm.startPrank(TestAddress.account1);
        votingToken.approve(address(harness), ACCOUNT1_STAKE);
        harness.stake(ACCOUNT1_STAKE);
        vm.stopPrank();

        vm.startPrank(TestAddress.account2);
        votingToken.approve(address(harness), ACCOUNT2_STAKE);
        harness.stake(ACCOUNT2_STAKE);
        vm.stopPrank();

        requestTime = block.timestamp - 1;
        vm.prank(REGISTERED_REQUESTER);
        harness.requestPrice(IDENTIFIER, requestTime, ANCILLARY_DATA);

        // Enqueued requests are voted on starting in the next round.
        vm.warp(harness.getRoundEndTime(harness.getCurrentRoundId()));
        roundId = harness.getCurrentRoundId();
        assertEq(uint256(harness.getVotePhase()), uint256(VotingV2Interface.Phase.Commit));

        bytes32 hash1 =
            keccak256(
                abi.encodePacked(
                    ACCOUNT1_PRICE,
                    ACCOUNT1_SALT,
                    TestAddress.account1,
                    requestTime,
                    ANCILLARY_DATA,
                    uint256(roundId),
                    IDENTIFIER
                )
            );
        vm.prank(TestAddress.account1);
        harness.commitVote(IDENTIFIER, requestTime, ANCILLARY_DATA, hash1);

        bytes32 hash2 =
            keccak256(
                abi.encodePacked(
                    ACCOUNT2_PRICE,
                    ACCOUNT2_SALT,
                    TestAddress.account2,
                    requestTime,
                    ANCILLARY_DATA,
                    uint256(roundId),
                    IDENTIFIER
                )
            );
        vm.prank(TestAddress.account2);
        harness.commitVote(IDENTIFIER, requestTime, ANCILLARY_DATA, hash2);
    }
}
