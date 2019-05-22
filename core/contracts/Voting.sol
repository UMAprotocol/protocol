pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./Testable.sol";
import "./VoteTiming.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title Voting system for Oracle.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting scheme.
 */
contract Voting is Testable {

    using SafeMath for uint;
    using VoteTiming for VoteTiming.Data;

    // Identifies a unique price request for which the Oracle will always return the same value.
    struct PriceRequest {
        bytes32 identifier;
        uint time;
    }

    struct Round {
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

    // Conceptually maps (identifier, time) pair to a `PriceResolution`.
    // Implemented as abi.encode(identifier, time) -> `PriceResolution`.
    mapping(bytes => PriceResolution) private priceResolutions;

    // Maps round numbers to the rounds.
    mapping(uint => Round) private rounds;

    VoteTiming.Data private voteTiming;

    constructor(uint phaseLength, bool _isTest) public Testable(_isTest) {
        voteTiming.init(phaseLength);
    }

    /**
     * @notice Commit your vote for a price request for `identifier` at `time`.
     * @dev (`identifier`, `time`) must correspond to a price request that's currently in the commit phase. `hash`
     * should be the keccak256 hash of the price you want to vote for and a `int salt`. Commits can be changed.
     */
    function commitVote(bytes32 identifier, uint time, bytes32 hash) external {
        require(hash != bytes32(0), "Committed hash of 0 is disallowed, choose a different salt");
        
        // Current time is required for all vote timing queries.
        uint currentTime = getCurrentTime();
        require(voteTiming.computeCurrentPhase(currentTime) == VoteTiming.Phase.Commit,
            "Cannot commit while in the reveal phase");

        // Should only update the round in the commit phase because a new round that's already in the reveal phase
        // would be wasted.
        _updateRound(currentTime);

        // At this point, the computed and last updated round ID should be equal.
        uint currentRoundId = voteTiming.computeCurrentRoundId(currentTime);

        PriceResolution storage priceResolution = _getPriceResolution(identifier, time);

        // This price request must be slated for this round.
        require(priceResolution.lastVotingRound == currentRoundId,
            "This (time, identifier) pair is not being voted on this round");

        VoteInstance storage voteInstance = priceResolution.votes[currentRoundId];
        voteInstance.committedHashes[msg.sender] = hash;
    }

    /**
     * @notice Reveal a previously committed vote for `identifier` at `time`.
     * @dev The revealed `price` and `salt` must match the latest `hash` that `commitVote()` was called with. Only the
     * committer can reveal their vote.
     */
    function revealVote(bytes32 identifier, uint time, int price, int salt) external {
        uint currentTime = getCurrentTime();
        require(voteTiming.computeCurrentPhase(currentTime) == VoteTiming.Phase.Reveal,
            "Cannot reveal while in the commit phase");

        // Note: computing the current round is required to disallow people from revealing an old commit after the
        // round is over.
        uint roundId = voteTiming.computeCurrentRoundId(currentTime);

        VoteInstance storage voteInstance = _getPriceResolution(identifier, time).votes[roundId];
        bytes32 hash = voteInstance.committedHashes[msg.sender];

        // 0 hashes are disallowed in the commit phase, so they indicate a different error.
        require(hash != bytes32(0), "Cannot reveal an uncommitted or previously revealed hash");
        require(keccak256(abi.encode(price, salt)) == voteInstance.committedHashes[msg.sender],
                "Committed hash doesn't match revealed price and salt");
        delete voteInstance.committedHashes[msg.sender];
    }

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given `identifier`, `time` pair.
     * @dev Returns the time at which the user should expect the price to be resolved.
     */
    function requestPrice(bytes32 identifier, uint time) external returns (uint expectedTime) {
        // TODO: we may want to allow future price requests and/or add a delay so that the price has enough time to be
        // widely distributed and agreed upon before the vote. 
        uint currentTime = getCurrentTime();
        require(time < currentTime);

        uint currentRoundId = voteTiming.computeCurrentRoundId(currentTime);
        uint priceResolutionRound = _getPriceResolution(identifier, time).lastVotingRound;

        if (priceResolutionRound == 0) {
            // Price has never been requested.

            // Must ensure the round is updated here so the requested price will be voted on in the next commit cycle.
            // TODO: this may be an expensive operation - may make sense to have a public updateRound() method to handle
            // extreme cases.
            _updateRound(currentTime);

            // Price requests always go in the next round, so add 1 to the computed current round.
            uint nextRoundId = currentRoundId.add(1);

            // Add price request to the next round.
            _addPriceRequestToRound(nextRoundId, PriceRequest(identifier, time));

            // Estimate the end of next round and return the time.
            return voteTiming.computeEstimatedRoundEndTime(nextRoundId);
        } else if (priceResolutionRound == currentRoundId) {
            // Price is currently being resolved.
            
            return voteTiming.computeEstimatedRoundEndTime(currentRoundId);
        } else {
            // Price has been resolved.
            return 0;
        }
    }

    /**
     * @notice Gets the price for `identifier` and `time` if it has already been requested and resolved.
     */
    function getPrice(bytes32 identifier, uint time) external view returns (int price) {
        PriceResolution storage priceResolution = _getPriceResolution(identifier, time);
        uint resolutionVotingRound = priceResolution.lastVotingRound;
        uint lastActiveVotingRound = voteTiming.getLastUpdatedRoundId();

        if (resolutionVotingRound < lastActiveVotingRound) {
            // Price must have been requested in the past.
            require(resolutionVotingRound != 0, "Price was never requested");

            // Price has been resolved.
            return priceResolution.resolvedPrice;
        } else {
            // Price has not yet been resolved.

            // Price must have been voted on this round for an immediate resolution to be attempted.
            require(resolutionVotingRound == lastActiveVotingRound, "Request has not yet been voted on");

            // If the current voting round has not ended, we cannot immediately resolve the vote.
            require(voteTiming.computeCurrentRoundId(getCurrentTime()) != lastActiveVotingRound,
                "The current voting round has not ended");

            // Attempt to resolve the vote immediately since the round has ended.
            (bool canBeResolved, int resolvedPrice) = _resolveVote(priceResolution.votes[resolutionVotingRound]);
            require(canBeResolved,
                "Price was not resolved this voting round. It will require another round of voting");
            return resolvedPrice;
        }
    }

    /**
     * @notice Gets the queries that are being voted on this round.
     */
    function getPendingRequests() external view returns (PriceRequest[] memory priceRequests) {
        uint currentTime = getCurrentTime();

        // Get the rollover price requests.
        PriceRequest[] memory rolloverPriceRequests;
        if (voteTiming.shouldUpdateRoundId(currentTime)) {
            rolloverPriceRequests = _getRolloverPriceRequests(voteTiming.computeCurrentRoundId(currentTime));
        } else {
            // Last active round is the current round, so no price requests need to be rolled.
            rolloverPriceRequests = new PriceRequest[](0);
        }

        // Grab the pending price requests that were already slated for this round.
        PriceRequest[] storage preexistingPriceRequests = rounds[
            voteTiming.computeCurrentRoundId(currentTime)].priceRequests;
        uint numPreexistingPriceRequests = preexistingPriceRequests.length;

        // Allocate the array to return.
        priceRequests = new PriceRequest[](rolloverPriceRequests.length + numPreexistingPriceRequests);

        // Add preexisting price requests to the array.
        for (uint i = 0; i < numPreexistingPriceRequests; i++) {
            priceRequests[i] = preexistingPriceRequests[i];
        }

        // Add rollover price requests to the array.
        for (uint i = 0; i < rolloverPriceRequests.length; i++) {
            priceRequests[i + numPreexistingPriceRequests] = rolloverPriceRequests[i];
        }
    }

    function getVotePhase() external view returns (VoteTiming.Phase) {
        return voteTiming.computeCurrentPhase(getCurrentTime());
    }

    function getCurrentRoundId() external view returns (uint) {
        return voteTiming.computeCurrentRoundId(getCurrentTime());
    }

    function _getRolloverPriceRequests(uint roundId)
        private
        view
        returns (PriceRequest[] memory rolloverPriceRequests)
    {
        PriceRequest[] storage allPriceRequests = rounds[roundId].priceRequests;
        uint numPriceRequests = allPriceRequests.length;

        // Allocate enough space for all of the price requests to be rolled over and just track the length
        // separately.
        PriceRequest[] memory tmpRolloverArray = new PriceRequest[](numPriceRequests);
        uint numRolloverPriceRequests = 0;

        // Note: the code here is very similar to that in _updateRound(). The reason I decided not use this method
        // there is that there is some complexity in this method wrt resizing in-memory arrays that's unnecessary when
        // changing storage. To preserve the gas-efficiency of _updateRound(), I didn't want to include that same
        // complexity there.
        for (uint i = 0; i < numPriceRequests; i++) {
            PriceRequest memory priceRequest = allPriceRequests[i];
            PriceResolution storage priceResolution = _getPriceResolution(priceRequest.identifier, priceRequest.time);
            (bool canBeResolved,) = _resolveVote(priceResolution.votes[roundId]);
            if (!canBeResolved) {
                tmpRolloverArray[numRolloverPriceRequests++] = priceRequest;
            }
        }

        // Copy price requests into the compressed array.
        rolloverPriceRequests = new PriceRequest[](numRolloverPriceRequests);
        for (uint i = 0; i < numRolloverPriceRequests; i++) {
            rolloverPriceRequests[i] = tmpRolloverArray[i];
        }
    }

    /**
     * @notice Adds a price request to a round.
     * @dev This can be used to roll a price request over to the next round or respond to a new requestPrice call.
     */
    function _addPriceRequestToRound(uint roundNumber, PriceRequest memory priceRequest) private {
        // Append to the list for this voting round.
        rounds[roundNumber].priceRequests.push(priceRequest);

        // Set the price resolution round number to the provided round.
        _getPriceResolution(priceRequest.identifier, priceRequest.time).lastVotingRound = roundNumber;
    }

    /**
     * @notice Attempts to resolve a vote.
     * @dev If the vote can be resolved, the method should return (true, X) where X is the price that the vote decided.
     * If the vote was not resolved, the method should return (false, 0).
     */
     // solhint-disable-next-line no-unused-vars
    function _resolveVote(VoteInstance storage voteInstance)
        private
        view
        returns (bool canBeResolved, int resolvedPrice)
    {
        // TODO: remove this dummy implementation once vote resolution is implemented.
        return (true, 1);
    }

    /**
     * @notice Looks up the price resolution for an identifier and time.
     * @dev The price resolutions are indexed by a hash of the identifier and time. This method is responsible for
     * doing that lookup.
     */
    function _getPriceResolution(bytes32 identifier, uint time) private view returns (PriceResolution storage) {
        bytes memory encodedArgs = abi.encode(identifier, time);
        return priceResolutions[encodedArgs];
    }

    function _updateRound(uint currentTime) private {
        if (voteTiming.shouldUpdateRoundId(currentTime)) {
            // Only do the rollover if the next round has started.
            uint lastActiveVotingRoundId = voteTiming.getLastUpdatedRoundId();
            Round storage lastActiveVotingRound = rounds[lastActiveVotingRoundId];

            uint nextVotingRoundId = voteTiming.computeCurrentRoundId(currentTime);

            for (uint i = 0; i < lastActiveVotingRound.priceRequests.length; i++) {
                PriceRequest storage priceRequest = lastActiveVotingRound.priceRequests[i];
                PriceResolution storage priceResolution = _getPriceResolution(
                    priceRequest.identifier,
                    priceRequest.time
                );

                // TODO: we should probably take this assert out before we move to production to keep the voting
                // contract from locking in the case of a bug. This would be an assert, but asserts don't allow
                // messages.
                require(priceResolution.lastVotingRound == lastActiveVotingRoundId,
                    "Found price request that was incorrectly placed in a round");
                (bool canBeResolved, int resolvedPrice) = _resolveVote(priceResolution.votes[lastActiveVotingRoundId]);
                if (canBeResolved) {
                    // If the vote can be resolved, just set the resolved price.
                    priceResolution.resolvedPrice = resolvedPrice;
                } else {
                    // If the vote cannot be resolved, push the request into the current round.
                    _addPriceRequestToRound(nextVotingRoundId, priceRequest);
                }
            }

            // Update the stored round to the current one.
            voteTiming.updateRoundId(currentTime);
        }
    }
}
