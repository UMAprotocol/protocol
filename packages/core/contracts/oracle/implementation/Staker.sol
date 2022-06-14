// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./Voting.sol";
import "./../../common/implementation/Testable.sol";

contract Staker is Voting {
    using ResultComputation for ResultComputation.Data;
    // Each User Stake is tracked with the information below.

    // APY emission trackers
    uint256 public emissionRate;
    uint256 public cumulativeStaked;
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;

    // Slashing trackers
    uint256 public lastRequestIndexConsidered;

    struct SlashingTracker {
        uint256 wrongVoteSlashPerToken;
        uint256 noVoteSlashPerToken;
        uint256 totalSlashed;
    }

    SlashingTracker[] public requestSlashTrackers;

    uint256 unstakeCoolDown;

    struct VoterStake {
        uint256 cumulativeStaked;
        // Pro-rata trackers.
        uint256 rewardsPaidPerToken;
        uint256 rewardsOutstanding;
        uint256 unstakeTime;
        uint256 requestUnstake;
        // Slashing trackers.
        uint256 lastRequestIndexConsidered;
        // Negative represents loss due to slashing. Positive represents gains due to voting right and capturing others slashed amounts.
        int256 unrealizedSlash;
    }

    mapping(address => VoterStake) public stakingBalances;

    

    constructor(
        uint256 _emissionRate,
        uint256 _unstakeCoolDown,
        uint256 _phaseLength,
        FixedPoint.Unsigned memory _gatPercentage,
        FixedPoint.Unsigned memory _inflationRate,
        uint256 _rewardsExpirationTimeout,
        address _votingToken,
        address _finder,
        address _timerAddress
    )
        Voting(
            _phaseLength,
            _gatPercentage,
            _inflationRate,
            _rewardsExpirationTimeout,
            _votingToken,
            _finder,
            _timerAddress
        )
    {
        emissionRate = _emissionRate;
        unstakeCoolDown = _unstakeCoolDown;
    }

    // Pulls tokens from users wallet and stakes them.
    function stake(uint256 amount) public {
        _updateTrackers(msg.sender);

        stakingBalances[msg.sender].cumulativeStaked += amount;
        cumulativeStaked += amount;

        if (stakingBalances[msg.sender].lastRequestIndexConsidered == 0)
            stakingBalances[msg.sender].lastRequestIndexConsidered = priceRequestIds.length;

        votingToken.transferFrom(msg.sender, address(this), amount);
    }

    function requestUnstake(uint256 amount) public {
        _updateTrackers(msg.sender);
        // Staker signals that they want to unstake. After signalling, their total voting balance is decreased by the
        // signaled amount. This amount is not vulnerable to being slashed but also does not accumulate rewards.

        require(stakingBalances[msg.sender].cumulativeStaked >= amount, "Bad request amount");

        stakingBalances[msg.sender].requestUnstake = amount;
        stakingBalances[msg.sender].unstakeTime = getCurrentTime() + unstakeCoolDown;
    }

    // Note there is no way to cancel your unstake; you must wait until after unstakeTime and re-stake.

    // If: a) staker requested an unstake and b) time > unstakeTime then send funds to staker of size requestUnstake
    // - any slashing amount is taken from the staker.
    function executeUnstake() public {
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = stakingBalances[msg.sender];
        require(voterStake.unstakeTime != 0 && getCurrentTime() > voterStake.unstakeTime, "Unstake time not passed");
        uint256 tokensToSend = voterStake.requestUnstake;
        if (voterStake.unrealizedSlash < 0) tokensToSend += uint256(voterStake.unrealizedSlash);

        if (tokensToSend > 0) {
            votingToken.transfer(msg.sender, tokensToSend);
            stakingBalances[msg.sender].cumulativeStaked -= voterStake.requestUnstake;
            cumulativeStaked -= voterStake.requestUnstake;
            voterStake.unrealizedSlash = 0;
        }
    }

    // Send accumulated rewards to the voter. If the total slashing amount is larger than the outstanding rewards
    // then this method does nothing.
    function withdrawRewards() public {
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = stakingBalances[msg.sender];
        int256 rewardsToSend = int256(voterStake.rewardsOutstanding) + voterStake.unrealizedSlash;
        if (rewardsToSend > 0) {
            voterStake.rewardsOutstanding = 0;
            voterStake.unrealizedSlash = 0;
            require(votingToken.mint(msg.sender, uint256(rewardsToSend)), "Voting token issuance failed");
        }
    }

    function _updateTrackers(address voterAddress) internal {
        _updateCumulativeSlashingTrackers();
        _updateAccountSlashingTrackers(voterAddress);
        _updateReward(voterAddress);
    }

    // Calculate the reward per token based on last time the reward was updated.
    function _updateReward(address voterAddress) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = getCurrentTime();
        if (voterAddress != address(0)) {
            VoterStake storage voterStake = stakingBalances[voterAddress];
            voterStake.rewardsOutstanding = outstandingRewards(voterAddress);
            voterStake.rewardsPaidPerToken = rewardPerTokenStored;
        }
    }

    function outstandingRewards(address voterAddress) public view returns (uint256) {
        VoterStake storage voterStake = stakingBalances[voterAddress];

        return
            ((voterStake.cumulativeStaked * (rewardPerToken() - voterStake.rewardsPaidPerToken)) / 1e18) +
            voterStake.rewardsOutstanding;
    }

    function rewardPerToken() public view returns (uint256) {
        if (cumulativeStaked == 0) return rewardPerTokenStored;

        return rewardPerTokenStored + ((getCurrentTime() - lastUpdateTime) * emissionRate * 1e18) / cumulativeStaked;
    }

    function _updateAccountSlashingTrackers(address voterAddress) internal {
        VoterStake storage voterStake = stakingBalances[voterAddress];
        // Note the method below can hit a gas limit of there are a LOT of requests from the last time this was run.
        // A future version of this should bound how many requests to look at per call to avoid gas limit issues.
        for (uint256 i = voterStake.lastRequestIndexConsidered; i < priceRequestIds.length; i++) {
            PriceRequest storage priceRequest = priceRequests[priceRequestIds[i].requestId];
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            bytes32 revealHash = voteInstance.voteSubmissions[voterAddress].revealHash;

            // The voter did not reveal or did not commit. Slash at noVote rate.
            if (revealHash == 0)
                voterStake.unrealizedSlash -= int256(
                    voterStake.cumulativeStaked * requestSlashTrackers[i].noVoteSlashPerToken
                );

                // The voter did not vote with the majority. Slash at wrongVote rate.
            else if (!voteInstance.resultComputation.wasVoteCorrect(revealHash))
                voterStake.unrealizedSlash -= int256(
                    voterStake.cumulativeStaked * requestSlashTrackers[i].wrongVoteSlashPerToken
                );

                // The voter voted correctly.Receive a pro-rate share of the other voters slashed amounts as a reward.
            else {
                uint256 roundId = rounds[priceRequestIds[i].roundId].snapshotId;
                uint256 totalStaked = votingToken.balanceOfAt(address(this), roundId);
                voterStake.unrealizedSlash += int256(
                    ((voterStake.cumulativeStaked * 1e18) / totalStaked) * requestSlashTrackers[i].totalSlashed
                );
            }
        }
    }

    function _updateCumulativeSlashingTrackers() internal {
        // Note the method below can hit a gas limit of there are a LOT of requests from the last time this was run.
        // A future version of this should bound how many requests to look at per call to avoid gas limit issues.
        for (uint256 i = lastRequestIndexConsidered; i < priceRequestIds.length; i++) {
            PriceRequest storage priceRequest = priceRequests[priceRequestIds[i].requestId];
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            uint256 roundId = rounds[priceRequestIds[i].roundId].snapshotId;

            uint256 totalStaked = votingToken.balanceOfAt(address(this), roundId);
            uint256 totalVotes = voteInstance.resultComputation.totalVotes.rawValue;
            uint256 totalCorrectVotes = voteInstance.resultComputation.getTotalCorrectlyVotedTokens().rawValue;

            uint256 wrongVoteSlashPerToken = wrongVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes);
            uint256 noVoteSlashPerToken = noVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes);

            uint256 totalSlashed = ((noVoteSlashPerToken + wrongVoteSlashPerToken) * totalStaked) / 1e18;
            requestSlashTrackers.push(SlashingTracker(wrongVoteSlashPerToken, noVoteSlashPerToken, totalSlashed));
        }
        lastRequestIndexConsidered = priceRequestIds.length;
    }

    // todo: update the two functions below to be pulled from a "library" that can be updated to govern how slashing works.
    // The numbers below assume 10 votes per month and 120 votes per year, a slashing rate equal to a ~20% emission to
    // keep balances roughly flat over the period.

    function wrongVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes
    ) public pure returns (uint256) {
        return 1600000000000000;
    }

    function noVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes
    ) public pure returns (uint256) {
        return 1600000000000000;
    }
}
