pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "../../v0/contracts/Testable.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title Voting system for Oracle.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting scheme.
 */
contract Voting is Testable {

    using SafeMath for uint;

    // The current voting round for the contract. Note: this assumes voting rounds do not overlap.
    uint currentRoundNumber;

    // Identifies a unique price request for which the Oracle will always return the same value.
    struct PriceRequest {
        bytes32 identifier;
        uint time;
    }

    // Enum that signifies what stage a particular voting round is in.
    enum VoteStage {
        // Voting round has not begun. Default value.
        Unstarted,

        // Voters can commit hashes representing their hidden votes.
        Commit,

        // Voters can reveal their previously committed votes.
        Reveal,

        // The round is over and all votes that could be resolved have been.
        Closed
    }

    struct Round {
        // The stage of voting for this round.
        VoteStage voteStage;

        // The list of price requests that were/are being voted on this round.
        PriceRequest[] priceRequests;
    }

    struct VoteInstance {
        // Maps (voterAddress) to their committed hash.
        // A bytes32 of `0` indicates no commit or a commit that was already revealed.
        mapping(address => bytes32) committedHashes;
    }

    struct PriceResolution {
        // A map containing all votes for this price in various rounds.
        mapping(uint => VoteInstance) votes;

        // The price that was resolved. 0 if it hasn't been resolved.
        int resolvedPrice;

        // If in the past, this was the voting round where this price was resolved. If current or in the future, this
        // is the next voting round where this price will be voted on.
        uint lastVotingRound;
    }

    // Conceptually maps (identifier, time) to a `PriceResolution`.
    mapping(bytes32 => mapping(uint => PriceResolution)) private priceResolutions;

    // Maps round numbers to the rounds.
    mapping(uint => Round) private rounds;

    constructor(bool _isTest) public Testable(_isTest) {
        currentRoundNumber = 1;
    }

    /**
     * @notice Commit your vote for a price request for `identifier` at `time`.
     * @dev (`identifier`, `time`) must correspond to a price request that's currently in the commit phase. `hash`
     * should be the keccak256 hash of the price you want to vote for and a `int salt`. Commits can be changed.
     */
    function commitVote(bytes32 identifier, uint time, bytes32 hash) external {
        require(hash != bytes32(0), "Committed hash of 0 is disallowed, choose a different salt");

        PriceResolution storage priceResolution = priceResolutions[identifier][time];

        // This price request must be slated for this round.
        // TODO: uncomment this line once phasing is implemented.
        // require(priceResolution.lastVotingRound == currentRoundNumber);

        VoteInstance storage voteInstance = priceResolution.votes[currentRoundNumber];
        voteInstance.committedHashes[msg.sender] = hash;
    }

    /**
     * @notice Reveal a previously committed vote for `identifier` at `time`.
     * @dev The revealed `price` and `salt` must match the latest `hash` that `commitVote()` was called with. Only the
     * committer can reveal their vote.
     */
    function revealVote(bytes32 identifier, uint time, int price, int salt) external {
        VoteInstance storage voteInstance = priceResolutions[identifier][time].votes[currentRoundNumber];
        require(keccak256(abi.encode(price, salt)) == voteInstance.committedHashes[msg.sender],
                "Committed hash doesn't match revealed price and salt");
        delete voteInstance.committedHashes[msg.sender];
    }

    /**
     * @notice Gets the price for `identifier` and `time` if it has already been requested and resolved.
     */
    function getPrice(bytes32 identifier, uint time) external view returns (int price) {
        PriceResolution storage priceResolution = priceResolutions[identifier][time];
        uint lastVotingRound = priceResolution.lastVotingRound;

        if (lastVotingRound < currentRoundNumber) {
            // Price must have been requested in the past.
            require(lastVotingRound != 0, "Price was never requested.");

            // Price has been resolved.
            return priceResolution.resolvedPrice;
        } else {
            // Price has not yet been resolved.

            // Price must have been voted on this round for an immediate resolution to be attempted.
            require(lastVotingRound == currentRoundNumber);

            // If the current voting round has not ended, we cannot immediately resolve the vote.
            require(_calcVotingRound() > currentRoundNumber, "The current voting round has not ended.");

            // Attempt to resolve the vote immediately since the round has ended.
            (bool canBeResolved, int resolvedPrice) = _resolveVote(priceResolution.votes[lastVotingRound]);
            require(canBeResolved, "Price was not resolved this voting round. It will require another round of voting.");
            return resolvedPrice;
        }
    }

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given `identifier`, `time` pair.
     * @dev Returns the time at which the user should expect the price to be resolved.
     */
    function requestPrice(bytes32 identifier, uint time) external returns (uint expectedTime) {
        uint priceResolutionRound = priceResolutions[identifier][time].lastVotingRound;
        uint secondsInWeek = 60*60*24*7;

        if (priceResolutionRound == 0) {
            // Price has never been requested.
            // Add price request to the next round.
            _addPriceRequestToRound(_calcVotingRound().add(1), PriceRequest(identifier, time));

            // TODO: replace this with the end of the next round once phasing has been implemented.
            return getCurrentTime().add(secondsInWeek.mul(2));
        } else if (priceResolutionRound == currentRoundNumber) {
            // Price is currently being resolved.
            // TODO: replace this with the end of the current round once phasing has been implemented.
            return getCurrentTime().add(secondsInWeek);
        } else {
            // Price has been resolved.
            return 0;
        }

    }

    /**
     * @notice Gets the queries that are being voted on this round.
     */
    function getPendingRequests() external returns (PriceRequest[] memory priceRequests) {
        return rounds[_calcVotingRound()].priceRequests;
    }

    /**
     * @notice Adds a price request to a round.
     * @dev This can be used to roll a price request over to the next round or respond to a new requestPrice call.
     */
    function _addPriceRequestToRound(uint roundNumber, PriceRequest memory priceRequest) private {
        // Append to the list for this voting round.
        Round storage round = rounds[roundNumber];
        require(round.voteStage == VoteStage.Unstarted);
        round.priceRequests.push(priceRequest);

        // Set the price resolution round number to the provided round.
        priceResolutions[priceRequest.identifier][priceRequest.time].lastVotingRound = roundNumber;
    }

    /**
     * @notice Calculates the current voting round based on the time.
     * @dev This should be used by any method that needs to know the current round number without updating the state.
     */
    function _calcVotingRound() private view returns (uint) {
        // TODO: return next voting round once the current one has ended.
        return currentRoundNumber;
    }

    /**
     * @notice Attempts to resolve a vote.
     * @dev If the vote can be resolved, the method should return (true, X) where X is the price that the vote decided.
     * If the vote was not resolved, the method should return (false, 0).
     */
    function _resolveVote(VoteInstance storage voteInstance) private view returns (bool canBeResolved, int resolvedPrice) {
        return (true, 0);
    }
}
