pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./Finder.sol";
import "./FixedPoint.sol";
import "./MultiRole.sol";
import "./OracleInterface.sol";
import "./Registry.sol";
import "./ResultComputation.sol";
import "./Testable.sol";
import "./VoteTiming.sol";
import "./VotingToken.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title Voting system for Oracle.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting scheme.
 */
contract Voting is Testable, MultiRole, OracleInterface {

    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint;
    using VoteTiming for VoteTiming.Data;
    using ResultComputation for ResultComputation.Data;

    // Identifies a unique price request for which the Oracle will always return the same value.
    struct PriceRequest {
        bytes32 identifier;
        uint time;
    }

    struct Round {
        // The list of price requests that were/are being voted on this round.
        PriceRequest[] priceRequests;

        // Voting token snapshot ID for this round. If this is 0, no snapshot has been taken.
        uint snapshotId;

        // Inflation rate set for this round.
        FixedPoint.Unsigned inflationRate;
    }

    // A particular voter's submission.
    struct VoteSubmission {
        // A bytes32 of `0` indicates no commit or a commit that was already revealed.
        bytes32 committedHash;

        // The value of the vote that was revealed.
        int revealedVote;

        // Whether the voter revealed their vote (this is to handle valid reveals for 0 prices).
        bool didReveal;
    }

    struct VoteInstance {
        // Maps (voterAddress) to their submission.
        mapping(address => VoteSubmission) voteSubmissions;

        // The data structure containing the computed voting results.
        ResultComputation.Data resultComputation;
    }

    struct PriceResolution {
        // A map containing all votes for this price in various rounds.
        mapping(uint => VoteInstance) votes;

        // The price that was resolved. 0 if it hasn't been resolved.
        int resolvedPrice;

        // If in the past, this was the voting round where this price was resolved. If current or the upcoming round,
        // this is the voting round where this price will be voted on, but not necessarily resolved.
        uint lastVotingRound;
    }

    // Conceptually maps (identifier, time) pair to a `PriceResolution`.
    // Implemented as abi.encode(identifier, time) -> `PriceResolution`.
    mapping(bytes => PriceResolution) private priceResolutions;

    // Maps round numbers to the rounds.
    mapping(uint => Round) private rounds;

    VoteTiming.Data private voteTiming;

    // The set of identifiers the oracle can provide verified prices for.
    mapping(bytes32 => bool) private supportedIdentifiers;

    // Percentage of the total token supply that must be used in a vote to create a valid price resolution.
    // 1 == 100%.
    FixedPoint.Unsigned private gatPercentage;

    // Global setting for the rate of inflation per vote. This is the percentage of the snapshotted total supply that
    // should be split among the correct voters. Note: this value is used to set per-round inflation at the beginning
    // of each round.
    // 1 = 100%
    FixedPoint.Unsigned private inflationRate;

    // Reference to the voting token.
    VotingToken private votingToken;

    // Voter address -> last round that they voted in.
    mapping(address => uint) private votersLastRound;

    // Reference to the Finder.
    Finder private finder;

    enum Roles {
        // Can set the writer.
        Governance,
        // Can change parameters and whitelists, such as adding new supported identifiers or changing the inflation
        // rate.
        // TODO: consider splitting this role into smaller roles with narrower permissions. 
        Writer
    }

    bool private initialized;

    // Max value of an unsigned integer.
    uint constant private UINT_MAX = ~uint(0);

    /**
     * @notice Construct the Voting contract.
     * @param phaseLength length of the commit and reveal phases in seconds.
     * @param _gatPercentage percentage of the total token supply that must be used in a vote to create a valid price
     * resolution.
     * @param _isTest whether this contract is being constructed for the purpose of running automated tests.
     */
    constructor(
        uint phaseLength,
        FixedPoint.Unsigned memory _gatPercentage,
        FixedPoint.Unsigned memory _inflationRate,
        address _votingToken,
        address _finder,
        bool _isTest
    ) public Testable(_isTest) {
        initializeOnce(phaseLength, _gatPercentage, _inflationRate);
        votingToken = VotingToken(_votingToken);
        finder = Finder(_finder);
    }

    modifier onlyRegisteredDerivative() {
        Registry registry = Registry(finder.getImplementationAddress("Registry"));
        require(registry.isDerivativeRegistered(msg.sender), "Must be registered derivative");
        _;
    }

    /**
     * @notice Commit your vote for a price request for `identifier` at `time`.
     * @dev (`identifier`, `time`) must correspond to a price request that's currently in the commit phase. `hash`
     * should be the keccak256 hash of the price you want to vote for and a `int salt`. Commits can be changed.
     */
    function commitVote(bytes32 identifier, uint time, bytes32 hash) external {
        require(hash != bytes32(0), "Committed hash of 0 is disallowed, choose a different salt");
        
        // Current time is required for all vote timing queries.
        uint blockTime = getCurrentTime();
        require(voteTiming.computeCurrentPhase(blockTime) == VoteTiming.Phase.Commit,
            "Cannot commit while in the reveal phase");

        // Should only update the round in the commit phase because a new round that's already in the reveal phase
        // would be wasted.
        _updateRound(blockTime);

        // At this point, the computed and last updated round ID should be equal.
        uint currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        PriceResolution storage priceResolution = _getPriceResolution(identifier, time);

        // This price request must be slated for this round.
        require(priceResolution.lastVotingRound == currentRoundId,
            "This (time, identifier) pair is not being voted on this round");

        VoteInstance storage voteInstance = priceResolution.votes[currentRoundId];
        voteInstance.voteSubmissions[msg.sender].committedHash = hash;

        if (votersLastRound[msg.sender] != currentRoundId) {
            retrieveRewards();
            votersLastRound[msg.sender] = currentRoundId;
        }
    }

    /**
     * @notice Reveal a previously committed vote for `identifier` at `time`.
     * @dev The revealed `price` and `salt` must match the latest `hash` that `commitVote()` was called with. Only the
     * committer can reveal their vote.
     */
    function revealVote(bytes32 identifier, uint time, int price, int salt) external {
        uint blockTime = getCurrentTime();
        require(voteTiming.computeCurrentPhase(blockTime) == VoteTiming.Phase.Reveal,
            "Cannot reveal while in the commit phase");

        // Note: computing the current round is required to disallow people from revealing an old commit after the
        // round is over.
        uint roundId = voteTiming.computeCurrentRoundId(blockTime);

        VoteInstance storage voteInstance = _getPriceResolution(identifier, time).votes[roundId];
        VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[msg.sender];
        bytes32 hash = voteSubmission.committedHash;

        // 0 hashes are disallowed in the commit phase, so they indicate a different error.
        require(hash != bytes32(0), "Cannot reveal an uncommitted or previously revealed hash");
        require(keccak256(abi.encode(price, salt)) == hash, "Committed hash doesn't match revealed price and salt");
        delete voteSubmission.committedHash;

        // Get or create a snapshot for this round.
        uint snapshotId = _getOrCreateSnapshotId(roundId);

        // Get the voter's snapshotted balance. Since balances are returned pre-scaled by 10**18, we can directly
        // initialize the Unsigned value with the returned uint.
        FixedPoint.Unsigned memory balance = FixedPoint.Unsigned(votingToken.balanceOfAt(msg.sender, snapshotId));

        // Set the voter's submission.
        voteSubmission.revealedVote = price;
        voteSubmission.didReveal = true;

        // Add vote to the results.
        voteInstance.resultComputation.addVote(price, balance);
    }

    function requestPrice(bytes32 identifier, uint time)
        external
        onlyRegisteredDerivative()
        returns (uint expectedTime)
    {
        // TODO: we may want to allow future price requests and/or add a delay so that the price has enough time to be
        // widely distributed and agreed upon before the vote. 
        uint blockTime = getCurrentTime();
        require(time < blockTime);
        require(supportedIdentifiers[identifier], "Price request for unsupported identifier");

        // Must ensure the round is updated here so the requested price will be voted on in the next commit cycle.
        // It's preferred to offload this cost to voters, but since the logic currently requires the rollover to be
        // done when adding new requests, it must be here.
        // TODO: look into how to elminate this call or require it only for a subset of the if cases below.
        // TODO: this may be an expensive operation - may make sense to have a public updateRound() method to handle
        // extreme cases.
        _updateRound(blockTime);

        uint currentRoundId = voteTiming.computeCurrentRoundId(blockTime);
        uint priceResolutionRound = _getPriceResolution(identifier, time).lastVotingRound;

        if (priceResolutionRound == 0) {
            // Price has never been requested.

            // Price requests always go in the next round, so add 1 to the computed current round.
            uint nextRoundId = currentRoundId.add(1);

            // Add price request to the next round.
            _addPriceRequestToRound(nextRoundId, PriceRequest(identifier, time));

            // Estimate the end of next round and return the time.
            return voteTiming.computeEstimatedRoundEndTime(nextRoundId);
        } else if (priceResolutionRound >= currentRoundId) {
            // Price is already slated to be resolved.
            
            return voteTiming.computeEstimatedRoundEndTime(priceResolutionRound);
        } else {
            // Price has been resolved.
            return 0;
        }
    }

    /**
     * @notice Adds the provided identifier as a supported identifier.
     */
    function addSupportedIdentifier(bytes32 identifier) external onlyRoleHolder(uint(Roles.Writer)) {
        if (!supportedIdentifiers[identifier]) {
            supportedIdentifiers[identifier] = true;
        }
    }

    function isIdentifierSupported(bytes32 identifier) external view returns (bool) {
        return supportedIdentifiers[identifier];
    }

    function hasPrice(bytes32 identifier, uint time) external view onlyRegisteredDerivative() returns (bool _hasPrice) {
        (_hasPrice, ,) = _getPriceOrError(identifier, time);
    }

    function getPrice(bytes32 identifier, uint time) external view onlyRegisteredDerivative() returns (int) {
        (bool _hasPrice, int price, string memory message) = _getPriceOrError(identifier, time);

        // If the price wasn't available, revert with the provided message.
        require(_hasPrice, message);
        return price;
    }

    /**
     * @notice Gets the queries that are being voted on this round.
     */
    function getPendingRequests() external view returns (PriceRequest[] memory priceRequests) {
        uint blockTime = getCurrentTime();

        // Grab the pending price requests that were already slated for this round.
        PriceRequest[] storage preexistingPriceRequests = rounds[
            voteTiming.computeCurrentRoundId(blockTime)].priceRequests;
        uint numPreexistingPriceRequests = preexistingPriceRequests.length;

        // Get the rollover price requests.
        (PriceRequest[] memory rolloverPriceRequests, uint numRolloverPriceRequests) = _getRolloverPriceRequests(
            blockTime);

        // Allocate the array to return.
        priceRequests = new PriceRequest[](numPreexistingPriceRequests + numRolloverPriceRequests);

        // Add preexisting price requests to the array.
        for (uint i = 0; i < numPreexistingPriceRequests; i++) {
            priceRequests[i] = preexistingPriceRequests[i];
        }

        // Add rollover price requests to the array.
        for (uint i = 0; i < numRolloverPriceRequests; i++) {
            priceRequests[i + numPreexistingPriceRequests] = rolloverPriceRequests[i];
        }
    }

    /**
     * @notice Gets the current vote phase (commit or reveal) based on the current block time.
     */
    function getVotePhase() external view returns (VoteTiming.Phase) {
        return voteTiming.computeCurrentPhase(getCurrentTime());
    }

    /**
     * @notice Gets the current vote round id based on the current block time.
     */
    function getCurrentRoundId() external view returns (uint) {
        return voteTiming.computeCurrentRoundId(getCurrentTime());
    }

    /**
     * @notice Resets the inflation rate. Note: this change only applies to rounds that have not yet begun.
     * @dev This method is public because calldata structs are not currently supported by solidity.
     */
    function setInflationRate(FixedPoint.Unsigned memory _inflationRate) public onlyRoleHolder(uint(Roles.Writer)) {
        inflationRate = _inflationRate;
    }

    /**
     * @notice Retrieves any rewards the voter is owed.
     */ 
    function retrieveRewards() public {
        uint blockTime = getCurrentTime();
        uint roundId = votersLastRound[msg.sender];

        if (roundId == voteTiming.computeCurrentRoundId(blockTime)) {
            // If the last round the voter participated in is the current round, rewards cannot be dispatched until the
            // round is over.
            return;
        }

        // Round must be updated (if possible) for the voter to retrieve rewards.
        // Note: this could be done only when the voter is trying to retrieve a reward for the most recently completed
        // round, but it makes the logic a bit simpler to just do it in all cases.
        _updateRound(blockTime);

        Round storage round = rounds[roundId];
        uint snapshotId = round.snapshotId;

        // If no snapshot has been created for this round, there are no rewards to dispatch.
        if (snapshotId == 0) {
            return;
        }

        // Get the voter's snapshotted balance.
        FixedPoint.Unsigned memory snapshotBalance = FixedPoint.Unsigned(
            votingToken.balanceOfAt(msg.sender, snapshotId));

        // Compute the total amount of reward that will be issued for each of the votes in the round.
        FixedPoint.Unsigned memory snapshotTotalSupply = FixedPoint.Unsigned(votingToken.totalSupplyAt(snapshotId));
        FixedPoint.Unsigned memory totalRewardPerVote = round.inflationRate.mul(snapshotTotalSupply);

        // Keep track of the voter's accumulated token reward.
        FixedPoint.Unsigned memory totalRewardToIssue = FixedPoint.Unsigned(0);

        // Loop over all price requests in the round to check for rewards.
        PriceRequest[] storage priceRequests = round.priceRequests;
        uint numPriceRequests = priceRequests.length;
        for (uint i = 0; i < numPriceRequests; i++) {

            // Grab references to the relevant parts of storage.
            PriceResolution storage priceResolution = _getPriceResolution(
                priceRequests[i].identifier, priceRequests[i].time);
            VoteInstance storage voteInstance = priceResolution.votes[roundId];
            VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[msg.sender];

            if (priceResolution.lastVotingRound == roundId
                && voteSubmission.didReveal
                && voteInstance.resultComputation.wasVoteCorrect(voteSubmission.revealedVote)) {
                // The price was successfully resolved during the voter's last voting round, the voter revealed and was
                // correct, so they are elgible for a reward.
                FixedPoint.Unsigned memory correctTokens = (voteInstance.resultComputation.
                    getTotalCorrectlyVotedTokens());

                // Compute the reward and add to the cumulative reward.
                FixedPoint.Unsigned memory reward = snapshotBalance.mul(totalRewardPerVote).div(correctTokens);
                totalRewardToIssue = totalRewardToIssue.add(reward);
            }

            // Delete the submission to capture any refund and clean up storage.
            delete voteInstance.voteSubmissions[msg.sender];
        }

        // Issue any accumulated rewards.
        if (totalRewardToIssue.isGreaterThan(0)) {
            require(votingToken.mint(msg.sender, totalRewardToIssue.value));
        }
    }

    /*
     * @notice Do not call this function externally.
     * @dev Only called from the constructor, and only extracted to a separate method to make the coverage tool work.
     * Will revert if called again.
     */
    function initializeOnce(
        uint phaseLength,
        FixedPoint.Unsigned memory _gatPercentage,
        FixedPoint.Unsigned memory _inflationRate
    )
        public
    {
        require(!initialized, "Only the constructor should call this method");
        initialized = true;
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        _createExclusiveRole(uint(Roles.Writer), uint(Roles.Governance), msg.sender);
        voteTiming.init(phaseLength);
        require(_gatPercentage.isLessThan(1), "GAT percentage must be < 100%");
        gatPercentage = _gatPercentage;
        inflationRate = _inflationRate;
    }

    /*
     * @dev Checks to see if there is a price that has or can be resolved for an (identifier, time) pair.
     * @returns a boolean noting whether a price is resolved, the price, and an error string if necessary.
     */
    function _getPriceOrError(bytes32 identifier, uint time)
        private
        view
        returns (bool _hasPrice, int price, string memory err)
    {
        PriceResolution storage priceResolution = _getPriceResolution(identifier, time);
        uint resolutionVotingRound = priceResolution.lastVotingRound;
        uint lastActiveVotingRound = voteTiming.getLastUpdatedRoundId();

        if (resolutionVotingRound < lastActiveVotingRound) {
            // Price must have been requested in the past.
            if (resolutionVotingRound == 0) {
                return (false, 0, "Price was never requested");
            }

            // Price has been resolved.
            return (true, priceResolution.resolvedPrice, "");
        } else {
            // Price has not yet been resolved.

            // Price must have been voted on this round for an immediate resolution to be attempted.
            if (resolutionVotingRound != lastActiveVotingRound) {
                return (false, 0, "Request has not yet been voted on");
            }

            // If the current voting round has not ended, we cannot immediately resolve the vote.
            if (voteTiming.computeCurrentRoundId(getCurrentTime()) == lastActiveVotingRound) {
                return (false, 0, "The current voting round has not ended");
            }

            // Attempt to resolve the vote immediately since the round has ended.
            VoteInstance storage voteInstance = priceResolution.votes[resolutionVotingRound];

            (bool isResolved, int resolvedPrice) = voteInstance.resultComputation.getResolvedPrice(
                _computeGat(resolutionVotingRound));
            if (!isResolved) {
                return (false, 0, "Price was not resolved this voting round. It will require another round of voting");
            }

            return (true, resolvedPrice, "");
        }
    }

    /**
     * @dev Gets a list of price requests that need to be rolled over from the last round. If a rollover doesn't need
     * to happen immediately, the array will be empty. The array may be longer than the number of populated elements,
     * so numRolloverPriceRequests gives the true number of elements.
     */
    function _getRolloverPriceRequests(uint blockTime)
        private
        view
        returns (PriceRequest[] memory rolloverPriceRequests, uint numRolloverPriceRequests)
    {
        // Return nothing if it is not yet time to roll votes over.
        if (!voteTiming.shouldUpdateRoundId(blockTime)) {
            return (new PriceRequest[](0), 0);
        }

        uint roundId = voteTiming.getLastUpdatedRoundId();
        PriceRequest[] storage allPriceRequests = rounds[roundId].priceRequests;
        uint numPriceRequests = allPriceRequests.length;

        // Allocate enough space for all of the price requests to be rolled over and just track the length
        // separately.
        rolloverPriceRequests = new PriceRequest[](numPriceRequests);
        numRolloverPriceRequests = 0;

        // Note: the code here is very similar to that in _updateRound(). The reason I decided not use this method
        // there is that there is some complexity in this method wrt creating potentially large in-memory arrays that's
        // unnecessary when changing storage. To preserve the gas-efficiency of _updateRound(), I didn't want to
        // include that same complexity there.
        for (uint i = 0; i < numPriceRequests; i++) {
            PriceRequest memory priceRequest = allPriceRequests[i];
            PriceResolution storage priceResolution = _getPriceResolution(priceRequest.identifier, priceRequest.time);
            VoteInstance storage voteInstance = priceResolution.votes[roundId];

            (bool isResolved,) = voteInstance.resultComputation.getResolvedPrice(_computeGat(roundId));
            if (!isResolved) {
                rolloverPriceRequests[numRolloverPriceRequests++] = priceRequest;
            }
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
     * @notice Looks up the price resolution for an identifier and time.
     * @dev The price resolutions are indexed by a hash of the identifier and time. This method is responsible for
     * doing that lookup.
     */
    function _getPriceResolution(bytes32 identifier, uint time) private view returns (PriceResolution storage) {
        bytes memory encodedArgs = abi.encode(identifier, time);
        return priceResolutions[encodedArgs];
    }

    /**
     * @notice Updates the round if necessary. After this method is run voteTiming.getLastUpdatedRoundId() and
     * and voteTiming.computeCurrentRoundId(blockTime) should return the same value.
     * @dev The method loops through all price requests for the last voting round and rolls them over to the next round
     * if required.
     */
    function _updateRound(uint blockTime) private {
        if (!voteTiming.shouldUpdateRoundId(blockTime)) {
            return;
        }

        // Only do the rollover if the next round has started.
        uint lastActiveVotingRoundId = voteTiming.getLastUpdatedRoundId();
        Round storage lastActiveVotingRound = rounds[lastActiveVotingRoundId];

        uint nextVotingRoundId = voteTiming.computeCurrentRoundId(blockTime);

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
            VoteInstance storage voteInstance = priceResolution.votes[lastActiveVotingRoundId];

            (bool isResolved, int resolvedPrice) = voteInstance.resultComputation.getResolvedPrice(
                _computeGat(lastActiveVotingRoundId));
            if (isResolved) {
                // If the vote can be resolved, just set the resolved price.
                priceResolution.resolvedPrice = resolvedPrice;
            } else {
                // If the vote cannot be resolved, push the request into the current round.
                _addPriceRequestToRound(nextVotingRoundId, priceRequest);

                // Zero out the price request to reduce gas costs.
                delete lastActiveVotingRound.priceRequests[i];
            }
        }

        // Set the round inflation rate to the current global inflation rate.
        rounds[nextVotingRoundId].inflationRate = inflationRate;

        // Update the stored round to the current one.
        voteTiming.updateRoundId(blockTime);
    }

    function _getOrCreateSnapshotId(uint roundId) private returns (uint) {
        Round storage round = rounds[roundId];
        if (round.snapshotId == 0) {
            // There is no snapshot ID set, so create one.
            round.snapshotId = votingToken.snapshot();
        }
        return round.snapshotId;
    }

    function _computeGat(uint roundId) private view returns (FixedPoint.Unsigned memory) {
        uint snapshotId = rounds[roundId].snapshotId;
        if (snapshotId == 0) {
            // No snapshot - return max value to err on the side of caution.
            return FixedPoint.Unsigned(UINT_MAX);
        }

        // Grab the snaphotted supply from the voting token. It's already scaled by 10**18, so we can directly
        // initialize the Unsigned value with the returned uint.
        FixedPoint.Unsigned memory snapshottedSupply = FixedPoint.Unsigned(votingToken.totalSupplyAt(snapshotId));

        // Multiply the total supply at the snapshot by the gatPercentage to get the GAT in number of tokens.
        return snapshottedSupply.mul(gatPercentage);
    }
}
