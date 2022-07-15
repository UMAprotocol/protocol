// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/StakerInterface.sol";

import "../../common/implementation/Testable.sol";
import "./VotingToken.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

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

    /****************************************
     *                EVENTS                *
     ****************************************/

    event Staked(
        address indexed voter,
        uint256 amount,
        uint256 voterActiveStake,
        uint256 voterPendingStake,
        uint256 voterPendingUnStake,
        uint256 cumulativeActiveStake,
        uint256 cumulativePendingStake
    );

    event RequestedUnstake(
        address indexed voter,
        uint256 amount,
        uint256 unstakeTime,
        uint256 voterActiveStake,
        uint256 voterPendingStake
    );

    event ExecutedUnstake(
        address indexed voter,
        uint256 tokensSent,
        uint256 voterActiveStake,
        uint256 voterPendingStake
    );

    event WithdrawnRewards(address indexed voter, uint256 tokensWithdrawn);

    event UpdatedReward(address indexed voter, uint256 newReward, uint256 lastUpdateTime);

    event UpdatedActiveStake(
        address indexed voter,
        uint256 voterActiveStake,
        uint256 voterPendingStake,
        uint256 cumulativeActiveStake,
        uint256 cumulativePendingStake
    );

    event SetNewEmissionRate(uint256 newEmissionRate);

    event SetNewUnstakeCooldown(uint256 newUnstakeCooldown);

    /**
     * @notice Construct the Staker contract
     * @param _emissionRate amount of voting tokens that are emitted per second, split prorate to stakers.
     * @param _unstakeCoolDown time that a voter must wait to unstake after requesting to unstake.
     *  to be voted on in the next round. If after this, the request is rolled to a round after the next round.
     * @param _votingToken address of the UMA token contract used to commit votes.
     * @param _timerAddress contract that stores the current time in a testing environment.
     * Must be set to 0x0 for production environments that use live time.
     */
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

    /**
     * @notice  Pulls tokens from users wallet and stakes them. If we are in a active reveal phase the stake amount
     * will be added to the pending stake. If not, the stake amount will be added to the active stake.
     * @param amount the amount of tokens to stake.
     */
    function stake(uint256 amount) public override {
        VoterStake storage voterStake = voterStakes[msg.sender];
        // If the staker has a cumulative staked balance of 0 then we can shortcut their lastRequestIndexConsidered to
        // the most recent index. This means we don't need to traverse requests where the staker was not staked.
        if (getVoterStake(msg.sender) + voterStake.pendingStake == 0)
            voterStake.lastRequestIndexConsidered = getStartingIndexForStaker();

        _updateTrackers(msg.sender);
        if (inActiveReveal()) {
            voterStake.pendingStake += amount;
            cumulativePendingStake += amount;
        } else {
            voterStake.activeStake += amount;
            cumulativeActiveStake += amount;
        }

        votingToken.transferFrom(msg.sender, address(this), amount);
        emit Staked(
            msg.sender,
            amount,
            voterStake.activeStake,
            voterStake.pendingStake,
            voterStake.pendingUnstake,
            cumulativeActiveStake,
            cumulativePendingStake
        );
    }

    /**
     * @notice Request a certain number of tokens to be unstaked. After the unstake time expires, the user may execute the unstake.
     * This function cannot be called while a reveal phase is active.
     * Note that there is no way to cancel an unstake request. Therefore, the user must wait to execute the unstake and re-stake.
     * @param amount the amount of tokens to request to be unstaked.
     */
    function requestUnstake(uint256 amount) public override {
        require(!inActiveReveal(), "In an active reveal phase");
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = voterStakes[msg.sender];

        // Staker signals that they want to unstake. After signalling, their total voting balance is decreased by the
        // signaled amount. This amount is not vulnerable to being slashed but also does not accumulate rewards.
        require(voterStake.activeStake >= amount, "Bad request amount");
        require(voterStake.pendingUnstake == 0, "Have previous request unstake");

        cumulativeActiveStake -= amount;
        voterStake.pendingUnstake = amount;
        voterStake.activeStake -= amount;
        voterStake.unstakeRequestTime = getCurrentTime();

        emit RequestedUnstake(
            msg.sender,
            amount,
            voterStake.unstakeRequestTime,
            voterStake.activeStake,
            voterStake.pendingStake
        );
    }

    /**
     * @notice  Execute a previously requested unstake. Requires the unstake time to have passed.
     */
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

        emit ExecutedUnstake(msg.sender, tokensToSend, voterStake.activeStake, voterStake.pendingStake);
    }

    /**
     * @notice  Send accumulated rewards to the voter. If the voter has gained rewards from others slashing then this is included here.
     * If the total slashing is larger than the outstanding rewards then this method does nothing.
     * @return uint256 the amount of tokens sent to the voter.
     */
    function withdrawRewards() public override returns (uint256) {
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = voterStakes[msg.sender];

        uint256 tokensToMint = voterStake.outstandingRewards;
        if (tokensToMint > 0) {
            voterStake.outstandingRewards = 0;
            require(votingToken.mint(msg.sender, tokensToMint), "Voting token issuance failed");
        }
        emit WithdrawnRewards(msg.sender, tokensToMint);

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

    // Determine if we are in an active reveal phase. This function should be overridden by the child contract.
    function inActiveReveal() public virtual returns (bool) {
        return false;
    }

    function getStartingIndexForStaker() internal virtual returns (uint256) {
        return 0;
    }

    // Calculate the reward per token based on last time the reward was updated.
    function _updateReward(address voterAddress) internal {
        uint256 currentTime = getCurrentTime();
        uint256 newRewardPerToken = rewardPerToken();
        rewardPerTokenStored = newRewardPerToken;
        lastUpdateTime = currentTime;
        if (voterAddress != address(0)) {
            VoterStake storage voterStake = voterStakes[voterAddress];
            voterStake.outstandingRewards = outstandingRewards(voterAddress);
            voterStake.rewardsPaidPerToken = newRewardPerToken;
        }
        emit UpdatedReward(voterAddress, newRewardPerToken, lastUpdateTime);
    }

    // Updates the active stake of the voter if not in an active reveal phase.
    function _updateActiveStake(address voterAddress) internal {
        if (inActiveReveal()) return;
        cumulativeActiveStake += voterStakes[voterAddress].pendingStake;
        cumulativePendingStake -= voterStakes[voterAddress].pendingStake;
        voterStakes[voterAddress].activeStake += voterStakes[voterAddress].pendingStake;
        voterStakes[voterAddress].pendingStake = 0;
        emit UpdatedActiveStake(
            voterAddress,
            voterStakes[voterAddress].activeStake,
            voterStakes[voterAddress].pendingStake,
            cumulativeActiveStake,
            cumulativePendingStake
        );
    }

    /**
     * @notice  Determine the number of outstanding token rewards that can be withdrawn by a voter.
     * @param voterAddress the address of the voter.
     * @return uint256 the outstanding rewards.
     */
    function outstandingRewards(address voterAddress) public view returns (uint256) {
        VoterStake storage voterStake = voterStakes[voterAddress];

        return
            ((getVoterStake(voterAddress) * (rewardPerToken() - voterStake.rewardsPaidPerToken)) / 1e18) +
            voterStake.outstandingRewards;
    }

    /**
     * @notice  Calculate the reward per token based on the last time the reward was updated.
     * @return uint256 the reward per token.
     */
    function rewardPerToken() public view returns (uint256) {
        if (getCumulativeStake() == 0) return rewardPerTokenStored;
        return
            rewardPerTokenStored + ((getCurrentTime() - lastUpdateTime) * emissionRate * 1e18) / getCumulativeStake();
    }

    /**
     * @notice  Returns the total amount of tokens staked. This is the sum of the active stake and the pending stake.
     * @return uint256 the cumulative stake.
     */
    function getCumulativeStake() public view returns (uint256) {
        return cumulativeActiveStake + cumulativePendingStake;
    }

    /**
     * @notice  Returns the total amount of tokens staked by the voter.
     * @param voterAddress the address of the voter.
     * @return uint256 the total stake.
     */
    function getVoterStake(address voterAddress) public view returns (uint256) {
        return voterStakes[voterAddress].activeStake + voterStakes[voterAddress].pendingStake;
    }

    /**
     * @notice  Set the token's emission rate, the number of voting tokens that are emitted per second per staked token,
     * split prorate to stakers.
     * @param _emissionRate the new amount of voting tokens that are emitted per second, split prorate to stakers.
     */
    function setEmissionRate(uint256 _emissionRate) public onlyOwner {
        _updateReward(address(0));
        emissionRate = _emissionRate;
        emit SetNewEmissionRate(emissionRate);
    }

    /**
     * @notice  Set the length of the cool down period, the amount of time a voter must wait to unstake after
     * submitting a request to do so.
     * @param _unstakeCoolDown the new duration of the cool down period in seconds.
     */
    function setUnstakeCoolDown(uint256 _unstakeCoolDown) public onlyOwner {
        unstakeCoolDown = _unstakeCoolDown;
        emit SetNewUnstakeCooldown(unstakeCoolDown);
    }
}
