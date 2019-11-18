pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./EncryptedSender.sol";
import "./Finder.sol";
import "./FixedPoint.sol";
import "./MultiRole.sol";
import "./OracleInterface.sol";
import "./Registry.sol";
import "./ResultComputation.sol";
import "./Testable.sol";
import "./VoteTiming.sol";
import "./VotingToken.sol";
import "./VotingInterface.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title Voting system for Oracle.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting scheme.
 */
contract Voting is Testable, MultiRole, OracleInterface, VotingInterface, EncryptedSender {
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

        // The index in the `pendingPriceRequests` that references this PriceRequest. A value of UINT_MAX means that
        // this PriceRequest is resolved and has been cleaned up from `pendingPriceRequests`.
        uint index;
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

        // The hash of the value that was revealed.
        // Note: this is only used for computation of rewards.
        bytes32 revealHash;
    }

    // Captures the necessary data for making a commitment.
    // Used as a parameter when making batch commitments.
    // Not used as a data structure for storage.
    struct Commitment {
        bytes32 identifier;

        uint time;

        bytes32 hash;

        bytes encryptedVote;
    }

    // Captures the necessary data for revealing a vote.
    // Used as a parameter when making batch reveals.
    // Not used as a data structure for storage.
    struct Reveal {
        bytes32 identifier;

        uint time;

        int price;

        int salt;
    }

    struct Round {
        // Voting token snapshot ID for this round. If this is 0, no snapshot has been taken.
        uint snapshotId;

        // Inflation rate set for this round.
        FixedPoint.Unsigned inflationRate;
    }

    // Represents the status a price request has.
    enum RequestStatus {
        // Was never requested.
        NotRequested,
        // Is being voted on in the current round.
        Active,
        // Was resolved in a previous round.
        Resolved,
        // Is scheduled to be voted on in a future round.
        Future
    }

    // Maps round numbers to the rounds.
    mapping(uint => Round) private rounds;

    // Maps price request IDs to the PriceRequest struct.
    mapping(bytes32 => PriceRequest) private priceRequests;

    // Price request ids for price requests that haven't yet been marked as resolved. These requests may be for future
    // rounds.
    bytes32[] private pendingPriceRequests;

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

    function requestPrice(bytes32 identifier, uint time)
        external
        onlyRegisteredDerivative()
        returns (uint expectedTime)
    {
        uint blockTime = getCurrentTime();
        require(time < blockTime, "Price request must be for a time in the past");
        require(supportedIdentifiers[identifier], "Price request for unsupported identifier");

        // Must ensure the round is updated here so the requested price will be voted on in the next commit cycle.
        _updateRound(blockTime);

        bytes32 priceRequestId = _encodePriceRequest(identifier, time);
        PriceRequest storage priceRequest = priceRequests[priceRequestId];
        uint currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);
        if (requestStatus == RequestStatus.Active) {
            return voteTiming.computeEstimatedRoundEndTime(currentRoundId);
        } else if (requestStatus == RequestStatus.Resolved) {
            return 0;
        } else if (requestStatus == RequestStatus.Future) {
            return voteTiming.computeEstimatedRoundEndTime(priceRequest.lastVotingRound);
        }

        // Price has never been requested.
        // Price requests always go in the next round, so add 1 to the computed current round.
        uint nextRoundId = currentRoundId.add(1);

        priceRequests[priceRequestId] = PriceRequest({
            identifier: identifier,
            time: time,
            lastVotingRound: nextRoundId,
            index: pendingPriceRequests.length
        });
        pendingPriceRequests.push(priceRequestId);
        emit PriceRequestAdded(nextRoundId, identifier, time);

        // Estimate the end of next round and return the time.
        return voteTiming.computeEstimatedRoundEndTime(nextRoundId);
    }

    function batchCommit(Commitment[] calldata commits) external {
        for (uint i = 0; i < commits.length; i++) {
            if (commits[i].encryptedVote.length == 0) {
                commitVote(commits[i].identifier, commits[i].time, commits[i].hash);
            } else {
                commitAndPersistEncryptedVote(
                    commits[i].identifier,
                    commits[i].time,
                    commits[i].hash,
                    commits[i].encryptedVote);
            }
        }
    }

    function batchReveal(Reveal[] calldata reveals) external {
        for (uint i = 0; i < reveals.length; i++) {
            revealVote(reveals[i].identifier, reveals[i].time, reveals[i].price, reveals[i].salt);
        }
    }

    /**
     * @notice Adds the provided identifier as a supported identifier.
     */
    function addSupportedIdentifier(bytes32 identifier) external onlyRoleHolder(uint(Roles.Writer)) {
        if (!supportedIdentifiers[identifier]) {
            supportedIdentifiers[identifier] = true;
            emit SupportedIdentifierAdded(identifier);
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

    function getPendingRequests() external view returns (PendingRequest[] memory pendingRequests) {
        uint blockTime = getCurrentTime();
        uint currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        // Solidity memory arrays aren't resizable (and reading storage is expensive). Hence this hackery to filter
        // `pendingPriceRequests` only to those requests that `isActive()`.
        PendingRequest[] memory unresolved = new PendingRequest[](pendingPriceRequests.length);
        uint numUnresolved = 0;

        for (uint i = 0; i < pendingPriceRequests.length; i++) {
            PriceRequest storage priceRequest = priceRequests[pendingPriceRequests[i]];
            if (_getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active) {
                unresolved[numUnresolved] = PendingRequest(
                    { identifier: priceRequest.identifier, time: priceRequest.time });
                numUnresolved++;
            }
        }

        pendingRequests = new PendingRequest[](numUnresolved);
        for (uint i = 0; i < numUnresolved; i++) {
            pendingRequests[i] = unresolved[i];
        }
    }

    function getVotePhase() external view returns (VoteTiming.Phase) {
        return voteTiming.computeCurrentPhase(getCurrentTime());
    }

    function getCurrentRoundId() external view returns (uint) {
        return voteTiming.computeCurrentRoundId(getCurrentTime());
    }

    /**
     * @notice Whether the caller has a revealed vote for the current round for an (identifier, time).
     * @dev If the price request was resolved in a previous round, this function will return `false` even if the caller
     * did reveal a vote.
     */
    function hasRevealedVote(bytes32 identifier, uint time) external view returns (bool) {
        PriceRequest storage priceRequest = _getPriceRequest(identifier, time);
        uint currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        if (_getRequestStatus(priceRequest, currentRoundId) != RequestStatus.Active) {
            return false;
        }
        VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
        VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[msg.sender];

        return voteSubmission.revealHash != bytes32(0);
    }

    function commitVote(bytes32 identifier, uint time, bytes32 hash) public {
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
        require(_getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active,
                "Cannot commit on inactive request");

        priceRequest.lastVotingRound = currentRoundId;
        VoteInstance storage voteInstance = priceRequest.voteInstances[currentRoundId];
        voteInstance.voteSubmissions[msg.sender].commit = hash;

        emit VoteCommitted(msg.sender, currentRoundId, identifier, time);
    }

    function revealVote(bytes32 identifier, uint time, int price, int salt) public {
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
        voteSubmission.revealHash = keccak256(abi.encode(price));

        // Add vote to the results.
        voteInstance.resultComputation.addVote(price, balance);

        // Remove the stored message for this price request, if it exists.
        bytes32 topicHash = keccak256(abi.encode(identifier, time, roundId));
        removeMessage(msg.sender, topicHash);

        emit VoteRevealed(msg.sender, roundId, identifier, time, price, balance.rawValue);
    }

    function commitAndPersistEncryptedVote(
        bytes32 identifier,
        uint time,
        bytes32 hash,
        bytes memory encryptedVote
    ) public {
        commitVote(identifier, time, hash);

        uint roundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        bytes32 topicHash = keccak256(abi.encode(identifier, time, roundId));
        sendMessage(msg.sender, topicHash, encryptedVote);
    }

    /**
     * @notice Resets the inflation rate. Note: this change only applies to rounds that have not yet begun.
     * @dev This method is public because calldata structs are not currently supported by solidity.
     */
    function setInflationRate(FixedPoint.Unsigned memory _inflationRate) public onlyRoleHolder(uint(Roles.Writer)) {
        inflationRate = _inflationRate;
    }

    function retrieveRewards(uint roundId, PendingRequest[] memory toRetrieve) public {
        uint blockTime = getCurrentTime();
        _updateRound(blockTime);
        uint currentRoundId = voteTiming.computeCurrentRoundId(blockTime);
        require(roundId < currentRoundId);

        Round storage round = rounds[roundId];
        uint snapshotId = round.snapshotId;
        FixedPoint.Unsigned memory snapshotBalance = FixedPoint.Unsigned(
            votingToken.balanceOfAt(msg.sender, snapshotId));

        // Compute the total amount of reward that will be issued for each of the votes in the round.
        FixedPoint.Unsigned memory snapshotTotalSupply = FixedPoint.Unsigned(votingToken.totalSupplyAt(snapshotId));
        FixedPoint.Unsigned memory totalRewardPerVote = round.inflationRate.mul(snapshotTotalSupply);

        // Keep track of the voter's accumulated token reward.
        FixedPoint.Unsigned memory totalRewardToIssue = FixedPoint.Unsigned(0);

        for (uint i = 0; i < toRetrieve.length; i++) {
            PriceRequest storage priceRequest = _getPriceRequest(toRetrieve[i].identifier, toRetrieve[i].time);
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[msg.sender];

            require(priceRequest.lastVotingRound == roundId, "Only retrieve rewards for votes resolved in same round");

            _resolvePriceRequest(priceRequest, voteInstance);

            if (voteInstance.resultComputation.wasVoteCorrect(voteSubmission.revealHash)) {
                // The price was successfully resolved during the voter's last voting round, the voter revealed and was
                // correct, so they are elgible for a reward.
                FixedPoint.Unsigned memory correctTokens = voteInstance.resultComputation.
                    getTotalCorrectlyVotedTokens();

                // Compute the reward and add to the cumulative reward.
                FixedPoint.Unsigned memory reward = snapshotBalance.mul(totalRewardPerVote).div(correctTokens);
                totalRewardToIssue = totalRewardToIssue.add(reward);
            }

            // Delete the submission to capture any refund and clean up storage.
            delete voteSubmission.revealHash;
        }

        // Issue any accumulated rewards.
        if (totalRewardToIssue.isGreaterThan(0)) {
            require(votingToken.mint(msg.sender, totalRewardToIssue.rawValue));
            emit RewardsRetrieved(msg.sender, roundId, totalRewardToIssue.rawValue);
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
        uint currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());

        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);
        if (requestStatus == RequestStatus.Active) {
            return (false, 0, "The current voting round has not ended");
        } else if (requestStatus == RequestStatus.Resolved) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (, int resolvedPrice) = voteInstance.resultComputation.getResolvedPrice(
                _computeGat(priceRequest.lastVotingRound));
            return (true, resolvedPrice, "");
        } else if (requestStatus == RequestStatus.Future) {
            return (false, 0, "Price will be voted on in the future");
        } else {
            return (false, 0, "Price was never requested");
        }
    }

    function _getPriceRequest(bytes32 identifier, uint time) private view returns (PriceRequest storage) {
        return priceRequests[_encodePriceRequest(identifier, time)];
    }

    function _encodePriceRequest(bytes32 identifier, uint time) private pure returns (bytes32) {
        return keccak256(abi.encode(identifier, time));
    }

    function _getOrCreateSnapshotId(uint roundId) private returns (uint) {
        Round storage round = rounds[roundId];
        if (round.snapshotId == 0) {
            // There is no snapshot ID set, so create one.
            round.snapshotId = votingToken.snapshot();
        }

        return round.snapshotId;
    }

    function _resolvePriceRequest(PriceRequest storage priceRequest, VoteInstance storage voteInstance) private {
        if (priceRequest.index == UINT_MAX) {
            return;
        }
        (bool isResolved, int resolvedPrice) = voteInstance.resultComputation.getResolvedPrice(
            _computeGat(priceRequest.lastVotingRound));
        require(isResolved, "Can't resolve an unresolved price request");

        // Delete the resolved price request from pendingPriceRequests.
        uint lastIndex = pendingPriceRequests.length - 1;
        PriceRequest storage lastPriceRequest = priceRequests[pendingPriceRequests[lastIndex]];
        lastPriceRequest.index = priceRequest.index;
        pendingPriceRequests[priceRequest.index] = pendingPriceRequests[lastIndex];
        delete pendingPriceRequests[lastIndex];

        priceRequest.index = UINT_MAX;
        emit PriceResolved(priceRequest.lastVotingRound, priceRequest.identifier, priceRequest.time, resolvedPrice);
    }

    function _updateRound(uint blockTime) private {
        if (!voteTiming.shouldUpdateRoundId(blockTime)) {
            return;
        }
        uint nextVotingRoundId = voteTiming.computeCurrentRoundId(blockTime);

        // Set the round inflation rate to the current global inflation rate.
        rounds[nextVotingRoundId].inflationRate = inflationRate;

        // Update the stored round to the current one.
        voteTiming.updateRoundId(blockTime);
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

    function _getRequestStatus(PriceRequest storage priceRequest, uint currentRoundId)
        private
        view
        returns (RequestStatus)
    {
        if (priceRequest.lastVotingRound == 0) {
            return RequestStatus.NotRequested;
        } else if (priceRequest.lastVotingRound < currentRoundId) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (bool isResolved, ) = voteInstance.resultComputation.getResolvedPrice(
                _computeGat(priceRequest.lastVotingRound));
            return isResolved ? RequestStatus.Resolved : RequestStatus.Active;
        } else if (priceRequest.lastVotingRound == currentRoundId) {
            return RequestStatus.Active;
        } else {
            // Means than priceRequest.lastVotingRound > currentRoundId
            return RequestStatus.Future;
        }
    }

    event VoteCommitted(address indexed voter, uint indexed roundId, bytes32 indexed identifier, uint time);

    event VoteRevealed(
        address indexed voter,
        uint indexed roundId,
        bytes32 indexed identifier,
        uint time,
        int price,
        uint numTokens
    );

    event RewardsRetrieved(address indexed voter, uint indexed rewardsRoundId, uint numTokens);

    event PriceRequestAdded(uint indexed votingRoundId, bytes32 indexed identifier, uint time);

    event PriceResolved(uint indexed resolutionRoundId, bytes32 indexed identifier, uint time, int price);

    event SupportedIdentifierAdded(bytes32 indexed identifier);
}
