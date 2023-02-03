// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./CommonDataVerificationMechanismForkTest.sol";

contract FakeLifeCycle is CommonDataVerificationMechanismForkTest {
    function setUp() public {
        _commonSetup();
    }

    function test_CanEnqueueRequestAndVoteWithNewlyStakedTokens() public {
        if (!shouldRunForkedTest) return; // Exit early if we are not executing forked tests.

        // Submit a new request and show it increments.
        // Ensure we are at the start of a voting round so we can stake and vote without the stake being disabled.
        if (voting.getVotePhase() == VotingV2Interface.Phase.Reveal) moveToNextRound();

        (uint256 numberRequestsPreRequest, ) = voting.getNumberOfPriceRequests();
        vm.prank(registeredRequester);
        voting.requestPrice(identifier, requestTime, ancillaryData);
        (uint256 numberRequestsPostRequest, ) = voting.getNumberOfPriceRequests();
        assert(numberRequestsPostRequest == numberRequestsPreRequest + 1);

        // Mint fresh UMA and stake them.
        vm.prank(address(voting));
        uint128 stakedNumOfTokens = gatMeetingNumOfTokens;
        votingToken.mint(TestAddress.account1, stakedNumOfTokens);
        vm.startPrank(TestAddress.account1);
        votingToken.approve(address(voting), stakedNumOfTokens);
        uint256 stakeTime = voting.getCurrentTime();
        voting.stake(stakedNumOfTokens);
        assert(voting.getVoterStakePostUpdate(TestAddress.account1) == stakedNumOfTokens);

        // Advance some time to ensure reward accrual works as expected.
        moveToNextRound();
        voting.withdrawRewards(); // Check if the Staker claims rewards now they get the expected amount.
        uint256 stakerBalanceAfterRewardWithdrawal = votingToken.balanceOf(TestAddress.account1);
        assert(voting.getVoterStakePostUpdate(TestAddress.account1) == stakedNumOfTokens);

        uint256 rewardsPerToken =
            ((voting.getCurrentTime() - stakeTime) * voting.emissionRate() * 1e18) / voting.cumulativeStake();
        uint256 expectedRewards = (rewardsPerToken * voting.getVoterStakePostUpdate(TestAddress.account1)) / 1e18;
        assertEq(stakerBalanceAfterRewardWithdrawal, expectedRewards);

        // Move to next round, request a price and vote on it from the newly staked account.
        moveToNextRound();
        int256 price = 1e18;
        int256 salt = 42069;
        uint256 roundId = voting.getCurrentRoundId();
        address account = TestAddress.account1;
        bytes32 hash =
            keccak256(abi.encodePacked(price, salt, account, requestTime, ancillaryData, roundId, identifier));
        voting.commitVote(identifier, requestTime, ancillaryData, hash);
        moveToNextPhase();
        voting.revealVote(identifier, requestTime, price, ancillaryData, salt);

        // Check the price has resolved correctly.
        moveToNextRound();
        vm.stopPrank();
        vm.prank(registeredRequester);
        assertEq(voting.getPrice(identifier, requestTime, ancillaryData), price);

        // Finally, considering we were the only voter, we should be able to work out the slashing amount precisely.
        uint256 totalStakedAtVote = voting.cumulativeStake(); // Has not changed from when we staked.
        uint256 slashPerTokenPerNoVote =
            voting.slashingLibrary().calcNoVoteSlashPerToken(
                totalStakedAtVote,
                stakedNumOfTokens,
                stakedNumOfTokens,
                0
            );
        uint256 totalSlashedTokens = ((totalStakedAtVote - stakedNumOfTokens) * slashPerTokenPerNoVote) / 1e18;
        uint256 expectedStakerBalanceAfterSlashing = stakedNumOfTokens + totalSlashedTokens;
        assertEq(voting.getVoterStakePostUpdate(TestAddress.account1), expectedStakerBalanceAfterSlashing);
    }
}
