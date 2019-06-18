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
    // Tracks ongoing votes as well as the result of the vote.
    struct PriceRequest {
        bytes32 identifier;
        uint time;

        // A map containing all votes for this price in various rounds.
        mapping(uint => VoteInstance) voteInstances;

        // If in the past, this was the voting round where this price was resolved. If current or the upcoming round,
        // this is the voting round where this price will be voted on, but not necessarily resolved.
        uint lastVotingRound;
    }

    struct VoteInstance {
        // Maps (voterAddress) to their submission.
        mapping(address => VoteSubmission) voteSubmissions;

        // The data structure containing the computed voting results.
        ResultComputation.Data resultComputation;
    }

    struct VoteSubmission {
        // A bytes32 of `0` indicates no commit or a commit that was already revealed.
        bytes32 commit;

        // The value of the vote that was revealed.
        int reveal;

        // Whether the voter revealed their vote (this is to handle valid reveals for 0 prices).
        bool didReveal;
    }

    struct Round {
        // The list of price requests that were/are being voted on this round.
        bytes32[] priceRequestIds;

        // Voting token snapshot ID for this round. If this is 0, no snapshot has been taken.
        uint snapshotId;

        // Inflation rate set for this round.
        FixedPoint.Unsigned inflationRate;
    }

    // PendingRequest is only used as return values for view functions and
    // therefore in-memory only.
    struct PendingRequest {
        bytes32 identifier;
        uint time;
    }

    // Maps round numbers to the rounds.
    mapping(uint => Round) private rounds;

    // Maps price request IDs to the PriceRequest struct.
    mapping(bytes32 => PriceRequest) private priceRequests;

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

        PriceRequest storage priceRequest = _getPriceRequest(identifier, time);

        // This price request must be slated for this round.
        require(priceRequest.lastVotingRound == currentRoundId,
            "This (time, identifier) pair is not being voted on this round");

        VoteInstance storage voteInstance = priceRequest.voteInstances[currentRoundId];
        voteInstance.voteSubmissions[msg.sender].commit = hash;

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

        PriceRequest storage priceRequest = _getPriceRequest(identifier, time);
        VoteInstance storage voteInstance = priceRequest.voteInstances[roundId];
        VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[msg.sender];

        // 0 hashes are disallowed in the commit phase, so they indicate a different error.
        require(voteSubmission.commit != bytes32(0), "Cannot reveal an uncommitted or previously revealed hash");
        require(keccak256(abi.encode(price, salt)) == voteSubmission.commit,
                "Committed hash doesn't match revealed price and salt");
        delete voteSubmission.commit;

        // Get or create a snapshot for this round.
        uint snapshotId = _getOrCreateSnapshotId(roundId);

        // Get the voter's snapshotted balance. Since balances are returned pre-scaled by 10**18, we can directly
        // initialize the Unsigned value with the returned uint.
        FixedPoint.Unsigned memory balance = FixedPoint.Unsigned(votingToken.balanceOfAt(msg.sender, snapshotId));

        // Set the voter's submission.
        voteSubmission.reveal = price;
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

        bytes32 priceRequestId = _encodePriceRequest(identifier, time);
        PriceRequest storage priceRequest = priceRequests[priceRequestId];
        uint priceResolutionRound = priceRequest.lastVotingRound;

        // Price is already slated to be resolved.
        if (priceResolutionRound >= currentRoundId) {
            return voteTiming.computeEstimatedRoundEndTime(priceResolutionRound);
        }

        // Price has been resolved
        if (priceResolutionRound != 0) {
            return 0;
        }

        // Price has never been requested.

        // Price requests always go in the next round, so add 1 to the computed current round.
        uint nextRoundId = currentRoundId.add(1);

        priceRequests[priceRequestId] = PriceRequest({
            identifier: identifier,
            time: time,
            lastVotingRound: nextRoundId
        });

        // Add price request to the next round.
        rounds[nextRoundId].priceRequestIds.push(priceRequestId);

        // Estimate the end of next round and return the time.
        return voteTiming.computeEstimatedRoundEndTime(nextRoundId);
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
    function getPendingRequests() external view returns (PendingRequest[] memory pendingRequests) {
        uint blockTime = getCurrentTime();

        // Grab the pending price requests that were already slated for this round.
        bytes32[] storage preexistingPriceRequests = rounds[
            voteTiming.computeCurrentRoundId(blockTime)].priceRequestIds;
        uint numPreexistingPriceRequests = preexistingPriceRequests.length;

        // Get the rollover price requests.
        (bytes32[] memory rolloverPriceRequests, uint numRolloverPriceRequests) = _getRolloverPriceRequests(
            blockTime);

        // Allocate the array to return.
        pendingRequests = new PendingRequest[](numPreexistingPriceRequests + numRolloverPriceRequests);

        // Add preexisting price requests to the array.
        for (uint i = 0; i < numPreexistingPriceRequests; i++) {
            PriceRequest storage priceRequest = priceRequests[preexistingPriceRequests[i]];
            pendingRequests[i] = PendingRequest({ identifier: priceRequest.identifier, time: priceRequest.time });
        }

        // Add rollover price requests to the array.
        for (uint i = 0; i < numRolloverPriceRequests; i++) {
            PriceRequest storage priceRequest = priceRequests[rolloverPriceRequests[i]];
            pendingRequests[i + numPreexistingPriceRequests] = PendingRequest({
                identifier: priceRequest.identifier,
                time: priceRequest.time
            });
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
        bytes32[] storage priceRequestIds = round.priceRequestIds;
        for (uint i = 0; i < priceRequestIds.length; i++) {
            PriceRequest storage priceRequest = priceRequests[priceRequestIds[i]];
            VoteInstance storage voteInstance = priceRequest.voteInstances[roundId];
            VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[msg.sender];

            // Note: The vote.didReveal condition checks two conditions.
            // That the voter revealed their vote AND that the vote resolved this round.
            // If the vote did not resolve, priceRequestIds[i] is 0x0 and vote.didReveal == false.
            if (voteSubmission.didReveal &&
                voteInstance.resultComputation.wasVoteCorrect(voteSubmission.reveal)) {
                // The price was successfully resolved during the voter's last voting round, the voter revealed and was
                // correct, so they are elgible for a reward.
                FixedPoint.Unsigned memory correctTokens = voteInstance.resultComputation.
                    getTotalCorrectlyVotedTokens();

                // Compute the reward and add to the cumulative reward.
                FixedPoint.Unsigned memory reward = snapshotBalance.mul(totalRewardPerVote).div(correctTokens);
                totalRewardToIssue = totalRewardToIssue.add(reward);
            }

            // Delete the submission to capture any refund and clean up storage.
            delete voteSubmission.reveal;
            delete voteSubmission.didReveal;
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
        PriceRequest storage priceRequest = _getPriceRequest(identifier, time);
        uint resolutionVotingRound = priceRequest.lastVotingRound;
        uint lastActiveVotingRound = voteTiming.getLastUpdatedRoundId();

        if (resolutionVotingRound < lastActiveVotingRound) {
            // Price must have been requested in the past.
            if (resolutionVotingRound == 0) {
                return (false, 0, "Price was never requested");
            }

            // Grab the resolution voting round to compute the resolved price.
            VoteInstance storage voteInstance = priceRequest.voteInstances[resolutionVotingRound];
            (, int pastResolvedPrice) = voteInstance.resultComputation.getResolvedPrice(
                _computeGat(resolutionVotingRound));

            // Price has been resolved.
            return (true, pastResolvedPrice, "");
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
            VoteInstance storage voteInstance = priceRequest.voteInstances[resolutionVotingRound];

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
        returns (bytes32[] memory rolloverPriceRequests, uint numRolloverPriceRequests)
    {
        // Return nothing if it is not yet time to roll votes over.
        if (!voteTiming.shouldUpdateRoundId(blockTime)) {
            return (new bytes32[](0), 0);
        }

        uint roundId = voteTiming.getLastUpdatedRoundId();
        bytes32[] storage allPriceRequests = rounds[roundId].priceRequestIds;
        uint numPriceRequests = allPriceRequests.length;

        // Allocate enough space for all of the price requests to be rolled over and just track the length
        // separately.
        rolloverPriceRequests = new bytes32[](numPriceRequests);
        numRolloverPriceRequests = 0;

        // Note: the code here is very similar to that in _updateRound(). The reason I decided not use this method
        // there is that there is some complexity in this method wrt creating potentially large in-memory arrays that's
        // unnecessary when changing storage. To preserve the gas-efficiency of _updateRound(), I didn't want to
        // include that same complexity there.
        for (uint i = 0; i < numPriceRequests; i++) {
            bytes32 priceRequestId = allPriceRequests[i];
            PriceRequest storage priceRequest = priceRequests[priceRequestId];
            VoteInstance storage voteInstance = priceRequest.voteInstances[roundId];

            (bool isResolved,) = voteInstance.resultComputation.getResolvedPrice(_computeGat(roundId));
            if (!isResolved) {
                rolloverPriceRequests[numRolloverPriceRequests++] = priceRequestId;
            }
        }
    }

    function _getPriceRequest(bytes32 identifier, uint time) private view returns (PriceRequest storage) {
        return priceRequests[_encodePriceRequest(identifier, time)];
    }

    function _encodePriceRequest(bytes32 identifier, uint time) private pure returns (bytes32) {
        return keccak256(abi.encode(identifier, time));
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

        for (uint i = 0; i < lastActiveVotingRound.priceRequestIds.length; i++) {
            bytes32 priceRequestId = lastActiveVotingRound.priceRequestIds[i];
            PriceRequest storage priceRequest = priceRequests[priceRequestId];

            // TODO: we should probably take this assert out before we move to production to keep the voting
            // contract from locking in the case of a bug. This would be an assert, but asserts don't allow
            // messages.
            require(priceRequest.lastVotingRound == lastActiveVotingRoundId,
                "Found price request that was incorrectly placed in a round");

            VoteInstance storage voteInstance = priceRequest.voteInstances[lastActiveVotingRoundId];

            (bool isResolved,) = voteInstance.resultComputation.getResolvedPrice(
                _computeGat(lastActiveVotingRoundId));

            if (!isResolved) {
                // If the vote cannot be resolved, push the request into the current round.
                rounds[nextVotingRoundId].priceRequestIds.push(priceRequestId);

                // Set the price resolution round number to the provided round.
                priceRequest.lastVotingRound = nextVotingRoundId;

                // Zero out the price request to reduce gas costs.
                delete lastActiveVotingRound.priceRequestIds[i];

                // Delete the result computation since it's no longer needed.
                delete voteInstance.resultComputation;
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
