// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract FakeLifeCycle is Common {
    function setUp() public {
        _commonSetup();
    }

    function test_CanEnqueueRequestAndVoteWithNewlyStakedTokens() public {
        if (!shouldRunTest) return; // Exit early if we are not executing forked tests.

        // Submit a new request and show it increments.
        // Ensure we are at the start of a voting round so we can stake and vote without the stake being disabled.
        if (voting.getVotePhase() == VotingV2Interface.Phase.Reveal) moveToNextRound();

        uint256 numberRequestsPreRequest = voting.getNumberOfPriceRequests();
        vm.prank(registeredRequester);
        voting.requestPrice(identifier, requestTime, ancillaryData);
        assert(voting.getNumberOfPriceRequests() == numberRequestsPreRequest + 1);

        // Mint fresh UMA and stake them.
        vm.prank(address(voting));
        votingToken.mint(TestAddress.account1, gatMeetingAmountOfTokens);

        vm.startPrank(TestAddress.account1);
        votingToken.approve(address(voting), gatMeetingAmountOfTokens);
        voting.stake(gatMeetingAmountOfTokens);
        assert(voting.getVoterStakePostUpdate(TestAddress.account1) == gatMeetingAmountOfTokens);

        // Move to next round and vote from the newly staked account.
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

        // Can unstake and has more than started with due to rewards and positive slashing.
        vm.startPrank(TestAddress.account1);
        voting.requestUnstake(voting.getVoterStakePostUpdate(TestAddress.account1));
        vm.warp(voting.getCurrentTime() + voting.unstakeCoolDown());
        voting.executeUnstake();
        assert(votingToken.balanceOf(TestAddress.account1) > gatMeetingAmountOfTokens);
    }
}
