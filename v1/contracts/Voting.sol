pragma solidity ^0.5.0;

contract Voting {
    enum RoundStatus {
        UNSTARTED,
        COMMIT,
        REVEAL,
        CLOSED
    }
    struct Round {
        RoundStatus roundStatus;
    }
    // Maps (roundNumber) to a `Round`.
    mapping(uint => Round) private rounds;

    struct VoteInstance {
        uint roundNumber;
        // Maps (voterAddress) to their committed hash.
        mapping(address => bytes32) committedHashes;
    }
    // Conceptually maps (identifier, time) to a `VoteInstance`.
    // TODO(ptare): Change to an array of VoteInstance if votes can fail.
    mapping(bytes32 => mapping(uint => VoteInstance)) private requests;
}
