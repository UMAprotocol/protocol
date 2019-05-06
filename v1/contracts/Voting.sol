pragma solidity ^0.5.0;


/**
 * @title Voting system for Oracle.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting scheme.
 */
contract Voting {

    struct VoteInstance {
        // Maps (voterAddress) to their committed hash.
        // A bytes32 of `0` indicates no commit or a commit that was already revealed.
        // TODO(ptare): Do we prefer to store an extra boolean instead?
        mapping(address => bytes32) committedHashes;
    }

    // Conceptually maps (identifier, time) to a `VoteInstance`.
    mapping(bytes32 => mapping(uint => VoteInstance)) private requests;

    /**
     * @notice Commit your vote for a price request for `identifier` at `time`.
     * @dev (`identifier`, `time`) must correspond to a price request that's currently in the commit phase. `hash`
     * should be the keccak256 hash of the price you want to vote for and a `int salt`. Commits can be changed.
     */
    function commitVote(bytes32 identifier, uint time, bytes32 hash) external {
        require(hash != bytes32(0), "Committed hash of 0 is disallowed, choose a different salt");
        VoteInstance storage voteInstance = requests[identifier][time];
        voteInstance.committedHashes[msg.sender] = hash;
    }

    /**
     * @notice Reveal a previously committed vote for `identifier` at `time`.
     * @dev The revealed `price` and `salt` must match the latest `hash` that `commitVote()` was called with. Only the
     * committer can reveal their vote.
     */
    function revealVote(bytes32 identifier, uint time, int price, int salt) external {
        VoteInstance storage voteInstance = requests[identifier][time];
        require(keccak256(abi.encode(price, salt)) == voteInstance.committedHashes[msg.sender],
                "Committed hash doesn't match revealed price and salt");
        voteInstance.committedHashes[msg.sender] = bytes32(0);
    }
}
