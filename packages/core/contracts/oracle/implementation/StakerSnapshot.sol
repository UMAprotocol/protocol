// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./VotingToken.sol";
import "../../common/implementation/Testable.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "hardhat/console.sol";

contract StakerSnapshot is Ownable, Testable {
    using Arrays for uint256[];
    using Counters for Counters.Counter;

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
        // Pro-rata trackers.
        uint256 rewardsPaidPerToken;
        uint256 outstandingRewards;
        uint256 unstakeTime;
        uint256 requestUnstake;
        // Slashing trackers.
        uint256 lastRequestIndexConsidered;
        // Negative represents loss due to slashing. Positive represents gains due to voting right and capturing others slashed amounts.
        int256 unrealizedSlash;
        Snapshots snapshots;
    }

    mapping(address => VoterStake) public stakingBalances;

    struct Snapshots {
        uint256[] ids;
        uint256[] values;
        // TODO: snapsnot the unrealizedSlash amount so this can be factored into your voting power.
    }

    Snapshots private _totalStakedSnapshots;

    // Snapshot ids increase monotonically, with the first value being 1. An id of 0 is invalid.
    Counters.Counter private _currentSnapshotId;

    // Reference to the voting token.
    VotingToken public votingToken;

    event Snapshot(uint256 id);

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
    function stake(uint256 amount) public {
        _updateTrackers(msg.sender);

        stakingBalances[msg.sender].cumulativeStaked += amount;
        cumulativeStaked += amount;

        votingToken.transferFrom(msg.sender, address(this), amount);
    }

    function snapshotStake(address voterAddress) public {
        _updateAccountSnapshot(voterAddress);
        _updateTotalStakedSnapshot();
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
        require(voterStake.unstakeTime != 0 && getCurrentTime() >= voterStake.unstakeTime, "Unstake time not passed");
        int256 tokensToSend = int256(voterStake.requestUnstake);
        if (voterStake.unrealizedSlash < 0) tokensToSend += voterStake.unrealizedSlash;

        if (tokensToSend > 0) {
            stakingBalances[msg.sender].cumulativeStaked -= voterStake.requestUnstake;
            cumulativeStaked -= voterStake.requestUnstake;
            voterStake.unrealizedSlash = 0;
            votingToken.transfer(msg.sender, uint256(tokensToSend));
        }
    }

    // Send accumulated rewards to the voter. If the total slashing amount is larger than the outstanding rewards
    // then this method does nothing.
    function withdrawRewards() public {
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = stakingBalances[msg.sender];
        uint256 rewardsToSend = voterStake.outstandingRewards;
        if (rewardsToSend > 0) {
            voterStake.outstandingRewards = 0;
            voterStake.unrealizedSlash = 0;
            require(votingToken.mint(msg.sender, rewardsToSend), "Voting token issuance failed");
        }
    }

    function _updateTrackers(address voterAddress) internal {
        _updateReward(voterAddress);
    }

    // Calculate the reward per token based on last time the reward was updated.
    function _updateReward(address voterAddress) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = getCurrentTime();
        if (voterAddress != address(0)) {
            VoterStake storage voterStake = stakingBalances[voterAddress];
            voterStake.outstandingRewards = outstandingRewards(voterAddress);
            voterStake.rewardsPaidPerToken = rewardPerTokenStored;
        }
    }

    //TODO: we should consider some of the numerical operations here. right now we track the notion of "cumulativeStaked"
    // separately from the unrealizedSlash and then effectively four the rewards at 0 if the resulting rewards go negative
    // due to the slash. Another implementation would be to slash by decreasing the users cumaltive stake and then not
    // change the outstanding rewards computation. I think the main reason to not do this as its easier to think about
    // the slashing if they are subtracted from your rewards first and then after that point they are taken from your
    // staked when you withdraw. in both implementations we correctly consider slashing amounts within the "voting power"
    // contribution within the Voting.sol contract.
    function outstandingRewards(address voterAddress) public view returns (uint256) {
        VoterStake storage voterStake = stakingBalances[voterAddress];

        uint256 outstandingRewards =
            ((voterStake.cumulativeStaked * (rewardPerToken() - voterStake.rewardsPaidPerToken)) / 1e18) +
                voterStake.outstandingRewards;
        // Consider the unrealized slashing amount. If this number is negative if the voter has been slashed and
        // positive if they have gained rewards from others slashing. This number will be negative if the voter has
        // lost more due to slashing then their total outstanding rewards. In this case, their outstanding rewards is
        // 0 and the loss of their token balance is captured when unstaking.
        int256 outstandingRewardsConsideringSlashing = int256(outstandingRewards) + voterStake.unrealizedSlash;
        if (outstandingRewardsConsideringSlashing > 0) return uint256(outstandingRewardsConsideringSlashing);
        else return 0;
    }

    function rewardPerToken() public view returns (uint256) {
        if (cumulativeStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((getCurrentTime() - lastUpdateTime) * emissionRate * 1e18) / cumulativeStaked;
    }

    // Owner methods

    function setEmissionRate(uint256 _emissionRate) public onlyOwner {
        emissionRate = _emissionRate;
    }

    function setUnstakeCoolDown(uint256 _unstakeCoolDown) public onlyOwner {
        unstakeCoolDown = _unstakeCoolDown;
    }

    // Snapshot methods

    function _snapshot() internal virtual returns (uint256) {
        _currentSnapshotId.increment();

        uint256 currentId = _getCurrentSnapshotId();
        emit Snapshot(currentId);
        return currentId;
    }

    /**
     * @dev Get the current snapshotId
     */
    function _getCurrentSnapshotId() internal view virtual returns (uint256) {
        return _currentSnapshotId.current();
    }

    function stakedAt(address account, uint256 snapshotId) public view virtual returns (uint256) {
        (bool snapshotted, uint256 value) = _valueAt(snapshotId, stakingBalances[account].snapshots);
        require(snapshotted, "Snapshot not found");
        return value;
    }

    /**
     * @dev Retrieves the total supply at the time `snapshotId` was created.
     */
    function totalStakedAt(uint256 snapshotId) public view virtual returns (uint256) {
        (bool snapshotted, uint256 value) = _valueAt(snapshotId, _totalStakedSnapshots);
        require(snapshotted, "Snapshot not found");
        return value;
    }

    function _valueAt(uint256 snapshotId, Snapshots storage snapshots) private view returns (bool, uint256) {
        require(snapshotId > 0, "StakerSnapshot: id is 0");
        require(snapshotId <= _getCurrentSnapshotId(), "StakerSnapshot: nonexistent id");

        // When a valid snapshot is queried, there are three possibilities:
        //  a) The queried value was not modified after the snapshot was taken. Therefore, a snapshot entry was never
        //  created for this id, and all stored snapshot ids are smaller than the requested one. The value that corresponds
        //  to this id is the current one.
        //  b) The queried value was modified after the snapshot was taken. Therefore, there will be an entry with the
        //  requested id, and its value is the one to return.
        //  c) More snapshots were created after the requested one, and the queried value was later modified. There will be
        //  no entry for the requested id: the value that corresponds to it is that of the smallest snapshot id that is
        //  larger than the requested one.
        //
        // In summary, we need to find an element in an array, returning the index of the smallest value that is larger if
        // it is not found, unless said value doesn't exist (e.g. when all values are smaller). Arrays.findUpperBound does
        // exactly this.

        uint256 index = snapshots.ids.findUpperBound(snapshotId);
        if (index == snapshots.ids.length) return (false, 0);
        else return (true, snapshots.values[index]);
    }

    function _updateAccountSnapshot(address account) private {
        _updateSnapshot(stakingBalances[account].snapshots, stakingBalances[account].cumulativeStaked);
    }

    function _updateTotalStakedSnapshot() private {
        _updateSnapshot(_totalStakedSnapshots, cumulativeStaked);
    }

    function _updateSnapshot(Snapshots storage snapshots, uint256 currentValue) private {
        uint256 currentId = _getCurrentSnapshotId();
        if (_lastSnapshotId(snapshots.ids) < currentId) {
            snapshots.ids.push(currentId);
            snapshots.values.push(currentValue);
            // TODO: we need to add cumlative slashing trackers here.
        }
    }

    function _lastSnapshotId(uint256[] storage ids) private view returns (uint256) {
        if (ids.length == 0) return 0;
        else return ids[ids.length - 1];
    }
}
