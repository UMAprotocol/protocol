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
    uint256 public cumulativeActiveStake;
    uint256 public cumulativePendingStake;
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;

    uint256 unstakeCoolDown;

    struct VoterStake {
        uint256 activeStake;
        uint256 pendingUnstake;
        uint256 pendingStake;
        uint256 rewardsPaidPerToken;
        uint256 outstandingRewards;
        uint256 unstakeRequestTime;
        uint256 lastRequestIndexConsidered;
        address delegate;
    }

    mapping(address => VoterStake) public voterStakes;

    // Mapping of delegates to the stakers (accounts who can vote on behalf of the stakers mapped to the staker).
    mapping(address => address) public delegateToStaker;

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
        // If the staker has a cumulative staked balance of 0 then we can shortcut their lastRequestIndexConsidered to
        // the most recent index. This means we don't need to traverse requests where the staker was not staked.
        if (getVoterStake(msg.sender) + voterStakes[msg.sender].pendingStake == 0)
            voterStakes[msg.sender].lastRequestIndexConsidered = getStartingIndexForStaker();

        _updateTrackers(msg.sender);
        if (inActiveReveal()) {
            voterStakes[msg.sender].pendingStake += amount;
            cumulativePendingStake += amount;
        } else {
            voterStakes[msg.sender].activeStake += amount;
            cumulativeActiveStake += amount;
        }

        votingToken.transferFrom(msg.sender, address(this), amount);
    }

    //You cant request to unstake during an active reveal phase.
    function requestUnstake(uint256 amount) public override {
        require(!inActiveReveal(), "In an active reveal phase");
        _updateTrackers(msg.sender);

        // Staker signals that they want to unstake. After signalling, their total voting balance is decreased by the
        // signaled amount. This amount is not vulnerable to being slashed but also does not accumulate rewards.
        require(voterStakes[msg.sender].activeStake >= amount, "Bad request amount");
        require(voterStakes[msg.sender].pendingUnstake == 0, "Have previous request unstake");

        cumulativeActiveStake -= amount;
        voterStakes[msg.sender].pendingUnstake = amount;
        voterStakes[msg.sender].activeStake -= amount;
        voterStakes[msg.sender].unstakeRequestTime = getCurrentTime();
    }

    // Note there is no way to cancel your unstake; you must wait until after unstakeRequestTime and re-stake.

    // If: a staker requested an unstake and time > unstakeRequestTime then send funds to staker. Note that this method assumes
    // that the `updateTrackers()
    function executeUnstake() public override {
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = voterStakes[msg.sender];
        require(
            voterStake.unstakeRequestTime != 0 && getCurrentTime() >= voterStake.unstakeRequestTime + unstakeCoolDown,
            "Unstake time not passed"
        );
        uint256 tokensToSend = voterStake.pendingUnstake;

        if (tokensToSend > 0) {
            voterStake.pendingUnstake = 0;
            voterStake.unstakeRequestTime = 0;
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
        _updateActiveStake(voterAddress);
    }

    function inActiveReveal() public virtual returns (bool) {
        return false;
    }

    function getStartingIndexForStaker() internal virtual returns (uint256) {
        return 0;
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

    function _updateActiveStake(address voterAddress) internal {
        if (inActiveReveal()) return;
        cumulativeActiveStake += voterStakes[voterAddress].pendingStake;
        cumulativePendingStake -= voterStakes[voterAddress].pendingStake;
        voterStakes[voterAddress].activeStake += voterStakes[voterAddress].pendingStake;
        voterStakes[voterAddress].pendingStake = 0;
    }

    function outstandingRewards(address voterAddress) public view returns (uint256) {
        VoterStake storage voterStake = voterStakes[voterAddress];

        return
            ((getVoterStake(voterAddress) * (rewardPerToken() - voterStake.rewardsPaidPerToken)) / 1e18) +
            voterStake.outstandingRewards;
    }

    function rewardPerToken() public view returns (uint256) {
        if (getCumulativeStake() == 0) return rewardPerTokenStored;
        return
            rewardPerTokenStored + ((getCurrentTime() - lastUpdateTime) * emissionRate * 1e18) / getCumulativeStake();
    }

    function getCumulativeStake() public view returns (uint256) {
        return cumulativeActiveStake + cumulativePendingStake;
    }

    function getVoterStake(address voterAddress) public view returns (uint256) {
        return voterStakes[voterAddress].activeStake + voterStakes[voterAddress].pendingStake;
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
