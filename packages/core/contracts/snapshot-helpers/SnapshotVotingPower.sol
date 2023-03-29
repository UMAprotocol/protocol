// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

/**
 * @title VotingInterface
 * @notice Minimum interface required to interact with VotingV2 contract.
 */
interface VotingInterface {
    struct VoterStake {
        uint128 stake;
        uint128 pendingUnstake;
        uint128 rewardsPaidPerToken;
        uint128 outstandingRewards;
        int128 unappliedSlash;
        uint64 nextIndexToProcess;
        uint64 unstakeTime;
        address delegate;
    }

    function voterStakes(address) external view returns (VoterStake memory);

    function getVoterFromDelegate(address) external view returns (address);
}

/**
 * @title SnapshotVotingPower
 * @notice Helper contract to support offchain voting with Snapshot.
 */
contract SnapshotVotingPower {
    VotingInterface public immutable votingV2 = VotingInterface(0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac);

    /**
     * @notice This is only used by Snapshot to calculate voting power and does not represent transferable tokens.
     * @param user address of the user for whom to calculate voting power.
     * @return uint256 value of user's voting power based on staked UMA at DVM2.0.
     **/
    function balanceOf(address user) external view returns (uint256) {
        address voter = votingV2.getVoterFromDelegate(user);
        VotingInterface.VoterStake memory voterStake = votingV2.voterStakes(voter);

        // Avoid double counting in case of stake delegation.
        if (voterStake.delegate != address(0) && user != voterStake.delegate) return 0;

        return uint256(voterStake.stake);
    }
}
