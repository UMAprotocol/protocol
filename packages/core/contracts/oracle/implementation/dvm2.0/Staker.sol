// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

contract Staker {
    // Each User Stake is tracked with the information below.

    uint256 inflationPerSecond;
    uint256 cumulativeStaked;
    uint256 rewardPerTokenStored;
    uint256 lastUpdateTime;
    uint256 actionLockTime = 30 days;

    struct UserStake {
        uint256 stakedBalance;
        // Pro-rata trackers.
        uint256 rewardsAccumulatedPerToken;
        uint256 rewardsOutstanding;
        uint256 unstakeTime;
        uint256 requestUnstake;
    }

    mapping(address => UserStake) stakingBalances;

    function stake(uint256 stakeAmount) public {
        // Pulls tokens from users wallet and stakes them. set their unstakeTime to current time + actionLockTime;
    }

    function requestUnstake(uint256 unstakeAmount) public {
        // Staker signals that they want to unstake. After signalling, their total voting balance is decreased by the
        // signaled amount. This amount is not vulnerable to being slashed but also does not accumulate rewards.
    }

    // Note there is no way to cancel your unstake; you must wait until after unstakeTime and re-stake.

    function unstake() public {
        // If: a) staker requested an unstake and b) time > unstakeTime then send funds to staker of size `requestUnstake`.
    }

    function retrieveRewards(address voterAddress) public {}

    function _updateCumlativeSlashedAmount(address voterAddress) internal {}
}
