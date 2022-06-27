// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./VotingToken.sol";
import "../../common/implementation/Testable.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

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
        uint256 rewardsPaidPerToken;
        uint256 outstandingRewards;
        uint256 unstakeTime;
        uint256 requestUnstake;
        uint256 lastRequestIndexConsidered;
        Snapshots snapshots;
    }

    mapping(address => VoterStake) public voterStakes;

    struct Snapshots {
        uint256[] ids;
        uint256[] values;
    }

    Snapshots private _cumulativeStakedSnapshots;

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
        updateSnapshot(msg.sender);

        voterStakes[msg.sender].cumulativeStaked += amount;
        cumulativeStaked += amount;

        votingToken.transferFrom(msg.sender, address(this), amount);
    }

    function updateSnapshot(address voterAddress) public {
        _updateAccountSnapshot(voterAddress);
        _updateTotalStakedSnapshot();
    }

    function requestUnstake(uint256 amount) public {
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
    // todo: consider blocking the execution of an unstake if we are in an active commit round.
    function executeUnstake() public {
        _updateTrackers(msg.sender);
        updateSnapshot(msg.sender);
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
    function withdrawRewards() public {
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = voterStakes[msg.sender];

        if (voterStake.outstandingRewards > 0) {
            require(votingToken.mint(msg.sender, voterStake.outstandingRewards));
            voterStake.outstandingRewards = 0;
        }
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
        return rewardPerTokenStored + (timeFromLastUpdate() * emissionRate * 1e18) / cumulativeStaked;
    }

    function timeFromLastUpdate() public view returns (uint256) {
        return getCurrentTime() - lastUpdateTime;
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

    function _getCurrentSnapshotId() internal view virtual returns (uint256) {
        return _currentSnapshotId.current();
    }

    function stakedAt(address voterAddress, uint256 snapshotId) public view virtual returns (uint256) {
        (bool snapshotted, uint256 value) = _valueAt(snapshotId, voterStakes[voterAddress].snapshots);
        // require(snapshotted, "Snapshot not found");
        // return value;
        return snapshotted ? value : voterStakes[voterAddress].cumulativeStaked;
    }

    function totalStakedAt(uint256 snapshotId) public view virtual returns (uint256) {
        (bool snapshotted, uint256 value) = _valueAt(snapshotId, _cumulativeStakedSnapshots);
        // require(snapshotted, "Snapshot not found");
        // return value;
        return snapshotted ? value : cumulativeStaked;
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

        if (index == snapshots.ids.length) {
            return (false, 0);
        } else {
            return (true, snapshots.values[index]);
        }
    }

    function _updateAccountSnapshot(address voterAddress) private {
        _updateSnapshot(voterStakes[voterAddress].snapshots, voterStakes[voterAddress].cumulativeStaked);
    }

    function _updateTotalStakedSnapshot() private {
        _updateSnapshot(_cumulativeStakedSnapshots, cumulativeStaked);
    }

    function _updateSnapshot(Snapshots storage snapshots, uint256 currentValue) private {
        uint256 currentId = _getCurrentSnapshotId();
        if (_lastSnapshotId(snapshots.ids) < currentId) {
            snapshots.ids.push(currentId);
            snapshots.values.push(currentValue);
        }
    }

    function _lastSnapshotId(uint256[] storage ids) private view returns (uint256) {
        if (ids.length == 0) return 0;
        else return ids[ids.length - 1];
    }
}
