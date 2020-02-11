pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "../../common/FixedPoint.sol";

/**
 * @title Interface that voters must use to Vote on price request resolutions.
 */
contract VotingInterface {
    struct PendingRequest {
        bytes32 identifier;
        uint time;
    }

    // Note: the phases must be in order. Meaning the first enum value must be the first phase, etc.
    enum Phase { Commit, Reveal, PLACEHOLDER_LAST_VALUE }

    /**
     * @notice Commit your vote for a price request for `identifier` at `time`.
     * @dev (`identifier`, `time`) must correspond to a price request that's currently in the commit phase. `hash`
     * should be the keccak256 hash of the price you want to vote for and a `int salt`. Commits can be changed.
     */
    function commitVote(bytes32 identifier, uint time, bytes32 hash) external;

    /**
     * @notice Reveal a previously committed vote for `identifier` at `time`.
     * @dev The revealed `price` and `salt` must match the latest `hash` that `commitVote()` was called with. Only the
     * committer can reveal their vote.
     */
    function revealVote(bytes32 identifier, uint time, int price, int salt) external;

    /**
     * @notice Gets the queries that are being voted on this round.
     */
    function getPendingRequests() external view returns (PendingRequest[] memory);

    /**
     * @notice Gets the current vote phase (commit or reveal) based on the current block time.
     */
    function getVotePhase() external view returns (Phase);

    /**
     * @notice Gets the current vote round id based on the current block time.
     */
    function getCurrentRoundId() external view returns (uint);

    /**
     * @notice Retrieves rewards owed for a set of resolved price requests.
     */
    function retrieveRewards(address voterAddress, uint roundId, PendingRequest[] memory)
        public
        returns (FixedPoint.Unsigned memory);
}
