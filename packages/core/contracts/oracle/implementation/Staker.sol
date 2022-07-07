// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/StakerInterface.sol";

import "./VotingToken.sol";
import "../../common/implementation/Testable.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

import "hardhat/console.sol";

contract Staker is StakerInterface, Ownable, Testable {
    /****************************************
     *           STAKING TRACKERS           *
     ****************************************/

    uint256 public emissionRate;
    uint256 public cumulativeStaked;
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;

    uint256 unstakeCoolDown;

    struct VoterStake {
        uint256 cumulativeStaked;
        uint256 rewardsPaidPerToken;
        uint256 outstandingRewards;
        uint256 unstakeTime;
        uint256 requestUnstake;
        uint256 lastRequestIndexConsidered;
    }

    mapping(address => VoterStake) public voterStakes;

    // Reference to the voting token.
    VotingToken public override votingToken;

    constructor(
        uint256 _emissionRate,
        uint256 _unstakeCoolDown,
        address _votingToken,
        address _timerAddress
    ) Testable(_timerAddress) {
        emissionRate = _emissionRate;
        unstakeCoolDown = _unstakeCoolDown;
        votingToken = VotingToken(_votingToken);
    }

    // Pulls tokens from users wallet and stakes them.
    function stake(uint256 amount) public override {
        _updateTrackers(msg.sender);
        voterStakes[msg.sender].cumulativeStaked += amount;
        cumulativeStaked += amount;

        votingToken.transferFrom(msg.sender, address(this), amount);
    }

    function requestUnstake(uint256 amount) public override {
        _updateTrackers(msg.sender);
        // Staker signals that they want to unstake. After signalling, their total voting balance is decreased by the
        // signaled amount. This amount is not vulnerable to being slashed but also does not accumulate rewards.

        require(voterStakes[msg.sender].cumulativeStaked >= amount, "Bad request amount");

        voterStakes[msg.sender].requestUnstake = amount;
        voterStakes[msg.sender].unstakeTime = getCurrentTime() + unstakeCoolDown;
    }

    // Note there is no way to cancel your unstake; you must wait until after unstakeTime and re-stake.

    // If: a staker requested an unstake and time > unstakeTime then send funds to staker. Note that this method assumes
    // that the `updateTrackers()
    function executeUnstake() public override {
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = voterStakes[msg.sender];
        require(voterStake.unstakeTime != 0 && getCurrentTime() >= voterStake.unstakeTime, "Unstake time not passed");
        uint256 tokensToSend = voterStake.requestUnstake;
        if (tokensToSend > voterStake.cumulativeStaked) tokensToSend = voterStake.cumulativeStaked;

        if (tokensToSend > 0) {
            voterStake.cumulativeStaked -= tokensToSend;
            cumulativeStaked -= voterStake.requestUnstake;
            voterStake.requestUnstake = 0;
            voterStake.unstakeTime = 0;
            votingToken.transfer(msg.sender, tokensToSend);
        }
    }

    // Send accumulated rewards to the voter. If the voter has gained rewards from others slashing then this is included
    // here. If the total slashing is larger than the outstanding rewards then this method does nothing.
    function withdrawRewards() public override returns (uint256) {
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = voterStakes[msg.sender];

        uint256 tokensToMint = voterStake.outstandingRewards;
        if (tokensToMint > 0) {
            voterStake.outstandingRewards = 0;
            require(votingToken.mint(msg.sender, tokensToMint), "Voting token issuance failed");
        }
        return (tokensToMint);
    }

    function exit() public {
        executeUnstake();
        withdrawRewards();
    }

    function _updateTrackers(address voterAddress) internal virtual {
        _updateReward(voterAddress);
    }

    // Calculate the reward per token based on last time the reward was updated.
    function _updateReward(address voterAddress) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = getCurrentTime();
        if (voterAddress != address(0)) {
            VoterStake storage voterStake = voterStakes[voterAddress];
            voterStake.outstandingRewards = outstandingRewards(voterAddress);
            voterStake.rewardsPaidPerToken = rewardPerTokenStored;
        }
    }

    function outstandingRewards(address voterAddress) public view returns (uint256) {
        VoterStake storage voterStake = voterStakes[voterAddress];

        return
            ((voterStake.cumulativeStaked * (rewardPerToken() - voterStake.rewardsPaidPerToken)) / 1e18) +
            voterStake.outstandingRewards;
    }

    function rewardPerToken() public view returns (uint256) {
        if (cumulativeStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((getCurrentTime() - lastUpdateTime) * emissionRate * 1e18) / cumulativeStaked;
    }

    // Owner methods
    function setEmissionRate(uint256 _emissionRate) public onlyOwner {
        _updateReward(address(0));
        emissionRate = _emissionRate;
    }

    function setUnstakeCoolDown(uint256 _unstakeCoolDown) public onlyOwner {
        unstakeCoolDown = _unstakeCoolDown;
    }
}
