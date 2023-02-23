// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "./ResultComputationV2.sol";
import "./Staker.sol";
import "./VoteTiming.sol";
import "./Constants.sol";

import "../interfaces/MinimumVotingAncillaryInterface.sol";
import "../interfaces/FinderInterface.sol";
import "../interfaces/IdentifierWhitelistInterface.sol";
import "../interfaces/OracleAncillaryInterface.sol";
import "../interfaces/OracleGovernanceInterface.sol";
import "../interfaces/OracleInterface.sol";
import "../interfaces/VotingV2Interface.sol";
import "../interfaces/RegistryInterface.sol";
import "../interfaces/SlashingLibraryInterface.sol";

/**
 * @title VotingV2 contract for the UMA DVM.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting schelling scheme.
 */

contract VotingV2 is Staker, OracleInterface, OracleAncillaryInterface, OracleGovernanceInterface, VotingV2Interface {
    using VoteTiming for VoteTiming.Data;
    using ResultComputationV2 for ResultComputationV2.Data;

    /****************************************
     *        VOTING DATA STRUCTURES        *
     ****************************************/

    // Identifies a unique price request. Tracks ongoing votes as well as the result of the vote.
    struct PriceRequest {
        uint32 lastVotingRound; // Last round that this price request was voted on. Updated when a request is rolled.
        bool isGovernance; // Denotes whether this is a governance request or not.
        uint64 time; // Timestamp used when evaluating the request.
        uint32 rollCount; // The number of rounds that a price request has rolled. Informs if a request can be deleted.
        bytes32 identifier; // Identifier that defines how the voters should resolve the request.
        mapping(uint32 => VoteInstance) voteInstances; // A map containing all votes for this price in various rounds.
        bytes ancillaryData; // Additional data used to resolve the request.
    }

    struct VoteInstance {
        mapping(address => VoteSubmission) voteSubmissions; // Maps (voter) to their submission.
        ResultComputationV2.Data results; // The data structure containing the computed voting results.
    }

    struct VoteSubmission {
        bytes32 commit; // A bytes32 of 0 indicates no commit or a commit that was already revealed.
        bytes32 revealHash; // The hash of the value that was revealed. This is only used for computation of rewards.
    }

    struct Round {
        SlashingLibraryInterface slashingLibrary; // Slashing library used to compute voter participation slash at this round.
        uint128 minParticipationRequirement; // Minimum staked tokens that must vote to resolve a request.
        uint128 minAgreementRequirement; // Minimum staked tokens that must agree on an outcome to resolve a request.
        uint128 cumulativeStakeAtRound; // Total staked tokens at the start of the round.
        uint32 numberOfRequestsToVote; // The number of requests to vote in this round.
    }

    struct SlashingTracker {
        uint256 wrongVoteSlashPerToken; // The amount of tokens slashed per token staked for a wrong vote.
        uint256 noVoteSlashPerToken; // The amount of tokens slashed per token staked for a no vote.
        uint256 totalSlashed; // The total amount of tokens slashed for a given request.
        uint256 totalCorrectVotes; // The total number of correct votes for a given request.
        uint32 lastVotingRound; // The last round that this request was voted on (when it resolved).
    }

    enum VoteParticipation {
        DidNotVote, // Voter did not vote.
        WrongVote, // Voter voted against the resolved price.
        CorrectVote // Voter voted with the resolved price.
    }

    // Represents the status a price request has.
    enum RequestStatus {
        NotRequested, // Was never requested.
        Active, // Is being voted on in the current round.
        Resolved, // Was resolved in a previous round.
        Future, // Is scheduled to be voted on in a future round.
        ToDelete // Is scheduled to be deleted.
    }

    // Only used as a return value in view methods -- never stored in the contract.
    struct RequestState {
        RequestStatus status;
        uint32 lastVotingRound;
    }

    /****************************************
     *            VOTING STATE              *
     ****************************************/

    uint32 public lastRoundIdProcessed; // The last round pendingPriceRequestsIds were traversed in.

    uint64 public nextPendingIndexToProcess; // Next pendingPriceRequestsIds index to process in lastRoundIdProcessed.

    FinderInterface public immutable finder; // Reference to the UMA Finder contract, used to find other UMA contracts.

    SlashingLibraryInterface public slashingLibrary; // Reference to Slashing Library, used to compute slashing amounts.

    VoteTiming.Data public voteTiming; // Vote timing library used to compute round timing related logic.

    OracleAncillaryInterface public immutable previousVotingContract; // Previous voting contract, if migrated.

    mapping(uint256 => Round) public rounds; // Maps round numbers to the rounds.

    mapping(bytes32 => PriceRequest) public priceRequests; // Maps price request IDs to the PriceRequest struct.

    bytes32[] public resolvedPriceRequestIds; // Array of resolved price requestIds. Used to track resolved requests.

    bytes32[] public pendingPriceRequestsIds; // Array of pending price requestIds. Can be resolved in the future.

    uint32 public maxRolls; // The maximum number of times a request can roll before it is deleted automatically.

    uint32 public maxRequestsPerRound; // The maximum number of requests that can be enqueued in a single round.

    address public migratedAddress; // If non-zero, this contract has been migrated to this address.

    uint128 public gat; // GAT: A minimum number of tokens that must participate to resolve a vote.

    uint64 public spat; // SPAT: Minimum percentage of staked tokens that must agree on the answer to resolve a vote.

    uint64 public constant UINT64_MAX = type(uint64).max; // Max value of an unsigned integer.

    uint256 public constant ANCILLARY_BYTES_LIMIT = 8192; // Max length in bytes of ancillary data.

    /****************************************
     *                EVENTS                *
     ****************************************/

    event VoteCommitted(
        address indexed voter,
        address indexed caller,
        uint32 roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData
    );

    event EncryptedVote(
        address indexed caller,
        uint32 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        bytes encryptedVote
    );

    event VoteRevealed(
        address indexed voter,
        address indexed caller,
        uint32 roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price,
        uint128 numTokens
    );

    event RequestAdded(
        address indexed requester,
        uint32 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        bool isGovernance
    );

    event RequestResolved(
        uint32 indexed roundId,
        uint256 indexed resolvedPriceRequestIndex,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price
    );

    event VotingContractMigrated(address newAddress);

    event RequestDeleted(bytes32 indexed identifier, uint256 indexed time, bytes ancillaryData, uint32 rollCount);

    event RequestRolled(bytes32 indexed identifier, uint256 indexed time, bytes ancillaryData, uint32 rollCount);

    event GatAndSpatChanged(uint128 newGat, uint64 newSpat);

    event SlashingLibraryChanged(address newAddress);

    event MaxRollsChanged(uint32 newMaxRolls);

    event MaxRequestsPerRoundChanged(uint32 newMaxRequestsPerRound);

    event VoterSlashApplied(address indexed voter, int128 slashedTokens, uint128 postStake);

    event VoterSlashed(address indexed voter, uint256 indexed requestIndex, int128 slashedTokens);

    /**
     * @notice Construct the VotingV2 contract.
     * @param _emissionRate amount of voting tokens that are emitted per second, split prorate between stakers.
     * @param _unstakeCoolDown time that a voter must wait to unstake after requesting to unstake.
     * @param _phaseLength length of the voting phases in seconds.
     * @param _maxRolls number of times a vote must roll to be auto deleted by the DVM.
     * @param _maxRequestsPerRound maximum number of requests that can be enqueued in a single round.
     * @param _gat number of tokens that must participate to resolve a vote.
     * @param _spat percentage of staked tokens that must agree on the result to resolve a vote.
     * @param _votingToken address of the UMA token contract used to commit votes.
     * @param _finder keeps track of all contracts within the system based on their interfaceName.
     * @param _slashingLibrary contract used to calculate voting slashing penalties based on voter participation.
     * @param _previousVotingContract previous voting contract address.
     */
    constructor(
        uint128 _emissionRate,
        uint64 _unstakeCoolDown,
        uint64 _phaseLength,
        uint32 _maxRolls,
        uint32 _maxRequestsPerRound,
        uint128 _gat,
        uint64 _spat,
        address _votingToken,
        address _finder,
        address _slashingLibrary,
        address _previousVotingContract
    ) Staker(_emissionRate, _unstakeCoolDown, _votingToken) {
        voteTiming.init(_phaseLength);
        finder = FinderInterface(_finder);
        previousVotingContract = OracleAncillaryInterface(_previousVotingContract);
        setGatAndSpat(_gat, _spat);
        setSlashingLibrary(_slashingLibrary);
        setMaxRequestPerRound(_maxRequestsPerRound);
        setMaxRolls(_maxRolls);
    }

    /***************************************
                    MODIFIERS
    ****************************************/

    modifier onlyRegisteredContract() {
        _requireRegisteredContract();
        _;
    }

    modifier onlyIfNotMigrated() {
        _requireNotMigrated();
        _;
    }

    /****************************************
     *  PRICE REQUEST AND ACCESS FUNCTIONS  *
     ****************************************/

    /**
     * @notice Enqueues a request (if a request isn't already present) for the identifier, time and ancillary data.
     * @dev Time must be in the past and the identifier must be supported. The length of the ancillary data is limited.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp for the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override nonReentrant onlyIfNotMigrated onlyRegisteredContract {
        _requestPrice(identifier, time, ancillaryData, false);
    }

    /**
     * @notice Enqueues a governance action request (if not already present) for identifier, time and ancillary data.
     * @dev Only the owner of the Voting contract can call this. In normal operation this is the Governor contract.
     * @param identifier uniquely identifies the price requested. E.g. Admin 0 (encoded as bytes32) could be requested.
     * @param time unix timestamp for the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     */
    function requestGovernanceAction(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) external override onlyOwner onlyIfNotMigrated {
        _requestPrice(identifier, time, ancillaryData, true);
    }

    /**
     * @notice Enqueues a request (if a request isn't already present) for the identifier, time pair.
     * @dev Overloaded method to enable short term backwards compatibility when ancillary data is not included.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp for the price request.
     */
    function requestPrice(bytes32 identifier, uint256 time) external override {
        requestPrice(identifier, time, "");
    }

    // Enqueues a request (if a request isn't already present) for the given identifier, time and ancillary data.
    function _requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool isGovernance
    ) internal {
        require(time <= getCurrentTime(), "Can only request in past");
        require(isGovernance || _getIdentifierWhitelist().isIdentifierSupported(identifier), "Unsupported identifier");
        require(ancillaryData.length <= ANCILLARY_BYTES_LIMIT, "Invalid ancillary data");

        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage priceRequest = priceRequests[priceRequestId];

        // Price has never been requested.
        uint32 currentRoundId = getCurrentRoundId();
        if (_getRequestStatus(priceRequest, currentRoundId) == RequestStatus.NotRequested) {
            uint32 roundIdToVoteOn = getRoundIdToVoteOnRequest(currentRoundId + 1);
            ++rounds[roundIdToVoteOn].numberOfRequestsToVote;
            priceRequest.identifier = identifier;
            priceRequest.time = uint64(time);
            priceRequest.ancillaryData = ancillaryData;
            priceRequest.lastVotingRound = roundIdToVoteOn;
            if (isGovernance) priceRequest.isGovernance = isGovernance;

            pendingPriceRequestsIds.push(priceRequestId);
            emit RequestAdded(msg.sender, roundIdToVoteOn, identifier, time, ancillaryData, isGovernance);
        }
    }

    /**
     * @notice Gets the round ID that a request should be voted on.
     * @param targetRoundId round ID to start searching for a round to vote on.
     * @return uint32 round ID that a request should be voted on.
     */
    function getRoundIdToVoteOnRequest(uint32 targetRoundId) public view returns (uint32) {
        while (rounds[targetRoundId].numberOfRequestsToVote >= maxRequestsPerRound) ++targetRoundId;
        return targetRoundId;
    }

    /**
     * @notice Returns whether the price for identifier, time and ancillary data is available.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @return bool if the DVM has resolved to a price for the given identifier, timestamp and ancillary data.
     */
    function hasPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override onlyRegisteredContract returns (bool) {
        (bool _hasPrice, , ) = _getPriceOrError(identifier, time, ancillaryData);
        return _hasPrice;
    }

    /**
     * @notice Whether the price for identifier and time is available.
     * @dev Overloaded method to enable short term backwards compatibility when ancillary data is not included.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of the price request.
     * @return bool if the DVM has resolved to a price for the given identifier and timestamp.
     */
    function hasPrice(bytes32 identifier, uint256 time) external view override returns (bool) {
        return hasPrice(identifier, time, "");
    }

    /**
     * @notice Gets the price for identifier, time and ancillary data if it has already been requested and resolved.
     * @dev If the price is not available, the method reverts.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @return int256 representing the resolved price for the given identifier, timestamp and ancillary data.
     */
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override onlyRegisteredContract returns (int256) {
        (bool _hasPrice, int256 price, string memory message) = _getPriceOrError(identifier, time, ancillaryData);

        // If the price wasn't available, revert with the provided message.
        require(_hasPrice, message);
        return price;
    }

    /**
     * @notice Gets the price for identifier and time if it has already been requested and resolved.
     * @dev Overloaded method to enable short term backwards compatibility when ancillary data is not included.
     * @dev If the price is not available, the method reverts.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of the price request.
     * @return int256 representing the resolved price for the given identifier and timestamp.
     */
    function getPrice(bytes32 identifier, uint256 time) external view override returns (int256) {
        return getPrice(identifier, time, "");
    }

    /**
     * @notice Gets the status of a list of price requests, identified by their identifier, time and ancillary data.
     * @dev If the status for a particular request is NotRequested, the lastVotingRound will always be 0.
     * @param requests array of pending requests which includes identifier, timestamp & ancillary data for the requests.
     * @return requestStates a list, in the same order as the input list, giving the status of the specified requests.
     */
    function getPriceRequestStatuses(PendingRequestAncillary[] memory requests)
        public
        view
        returns (RequestState[] memory)
    {
        RequestState[] memory requestStates = new RequestState[](requests.length);
        uint32 currentRoundId = getCurrentRoundId();
        for (uint256 i = 0; i < requests.length; i = unsafe_inc(i)) {
            PriceRequest storage priceRequest =
                _getPriceRequest(requests[i].identifier, requests[i].time, requests[i].ancillaryData);

            RequestStatus status = _getRequestStatus(priceRequest, currentRoundId);

            // If it's an active request, its true lastVotingRound is the current one, even if it hasn't been updated.
            if (status == RequestStatus.Active) requestStates[i].lastVotingRound = currentRoundId;
            else requestStates[i].lastVotingRound = priceRequest.lastVotingRound;
            requestStates[i].status = status;
        }
        return requestStates;
    }

    /****************************************
     *          VOTING FUNCTIONS            *
     ****************************************/

    /**
     * @notice Commit a vote for a price request for identifier at time.
     * @dev identifier, time must correspond to a price request that's currently in the commit phase.
     * Commits can be changed.
     * @dev Since transaction data is public, the salt will be revealed with the vote. While this is the system’s
     * expected behavior, voters should never reuse salts. If someone else is able to guess the voted price and knows
     * that a salt will be reused, then they can determine the vote pre-reveal.
     * @param identifier uniquely identifies the committed vote. E.g. BTC/USD price pair.
     * @param time unix timestamp of the price being voted on.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param hash keccak256 hash of the price, salt, voter address, time, ancillaryData, current roundId, identifier.
     */
    function commitVote(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bytes32 hash
    ) public override nonReentrant {
        uint32 currentRoundId = getCurrentRoundId();
        address voter = getVoterFromDelegate(msg.sender);
        _updateTrackers(voter);

        require(hash != bytes32(0), "Invalid commit hash");
        require(getVotePhase() == Phase.Commit, "Cannot commit in reveal phase");
        PriceRequest storage priceRequest = _getPriceRequest(identifier, time, ancillaryData);
        require(_getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active, "Request must be active");

        priceRequest.voteInstances[currentRoundId].voteSubmissions[voter].commit = hash;

        emit VoteCommitted(voter, msg.sender, currentRoundId, identifier, time, ancillaryData);
    }

    /**
     * @notice Reveal a previously committed vote for identifier at time.
     * @dev The revealed price, salt, voter address, time, ancillaryData, current roundId, identifier must hash to the
     * latest hash that commitVote() was called with. Only the committer can reveal their vote.
     * @param identifier voted on in the commit phase. E.g. BTC/USD price pair.
     * @param time specifies the unix timestamp of the price being voted on.
     * @param price voted on during the commit phase.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param salt value used to hide the commitment price during the commit phase.
     */
    function revealVote(
        bytes32 identifier,
        uint256 time,
        int256 price,
        bytes memory ancillaryData,
        int256 salt
    ) public override nonReentrant {
        uint32 currentRoundId = getCurrentRoundId();
        _freezeRoundVariables(currentRoundId);
        VoteInstance storage voteInstance =
            _getPriceRequest(identifier, time, ancillaryData).voteInstances[currentRoundId];
        address voter = getVoterFromDelegate(msg.sender);
        VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[voter];

        require(getVotePhase() == Phase.Reveal, "Reveal phase has not started yet"); // Can only reveal in reveal phase.

        // Zero hashes are blocked in commit; they indicate a different error: voter did not commit or already revealed.
        require(voteSubmission.commit != bytes32(0), "Invalid hash reveal");

        // Check that the hash that was committed matches to the one that was revealed. Note that if the voter had
        // then they must reveal with the same account they had committed with.
        require(
            keccak256(abi.encodePacked(price, salt, voter, time, ancillaryData, uint256(currentRoundId), identifier)) ==
                voteSubmission.commit,
            "Revealed data != commit hash"
        );

        delete voteSubmission.commit; // Small gas refund for clearing up storage.
        voteSubmission.revealHash = keccak256(abi.encode(price)); // Set the voter's submission.

        // Calculate the voters effective stake for this round as the difference between their stake and pending stake.
        // This allows for the voter to have staked during this reveal phase and not consider their pending stake.
        uint128 effectiveStake = voterStakes[voter].stake - voterStakes[voter].pendingStakes[currentRoundId];
        voteInstance.results.addVote(price, effectiveStake); // Add vote to the results.
        emit VoteRevealed(voter, msg.sender, currentRoundId, identifier, time, ancillaryData, price, effectiveStake);
    }

    /**
     * @notice Commits a vote and logs an event with a data blob, typically an encrypted version of the vote
     * @dev An encrypted version of the vote is emitted in an event EncryptedVote to allow off-chain infrastructure to
     * retrieve the commit. The contents of encryptedVote are never used on chain: it is purely for convenience.
     * @param identifier unique price pair identifier. E.g. BTC/USD price pair.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param hash keccak256 hash of the price you want to vote for and a int256 salt.
     * @param encryptedVote offchain encrypted blob containing the voter's amount, time and salt.
     */
    function commitAndEmitEncryptedVote(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bytes32 hash,
        bytes memory encryptedVote
    ) public override {
        commitVote(identifier, time, ancillaryData, hash);
        emit EncryptedVote(msg.sender, getCurrentRoundId(), identifier, time, ancillaryData, encryptedVote);
    }

    /****************************************
     *        VOTING GETTER FUNCTIONS       *
     ****************************************/

    /**
     * @notice Gets the requests that are being voted on this round.
     * @dev This view method returns requests with Active status that may be ahead of the stored contract state as this
     * also filters out requests that would be resolvable or deleted if the resolvable requests were processed with the
     * processResolvablePriceRequests() method.
     * @return pendingRequests array containing identifiers of type PendingRequestAncillaryAugmented.
     */
    function getPendingRequests() public view override returns (PendingRequestAncillaryAugmented[] memory) {
        // Solidity memory arrays aren't resizable (and reading storage is expensive). Hence this hackery to filter
        // pendingPriceRequestsIds only to those requests that have an Active RequestStatus.
        PendingRequestAncillaryAugmented[] memory unresolved =
            new PendingRequestAncillaryAugmented[](pendingPriceRequestsIds.length);
        uint256 numUnresolved = 0;
        uint32 currentRoundId = getCurrentRoundId();

        for (uint256 i = 0; i < pendingPriceRequestsIds.length; i = unsafe_inc(i)) {
            PriceRequest storage priceRequest = priceRequests[pendingPriceRequestsIds[i]];
            if (_getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active) {
                unresolved[numUnresolved] = PendingRequestAncillaryAugmented({
                    lastVotingRound: priceRequest.lastVotingRound,
                    isGovernance: priceRequest.isGovernance,
                    time: priceRequest.time,
                    rollCount: _getActualRollCount(priceRequest, currentRoundId),
                    identifier: priceRequest.identifier,
                    ancillaryData: priceRequest.ancillaryData
                });
                numUnresolved++;
            }
        }

        PendingRequestAncillaryAugmented[] memory pendingRequests =
            new PendingRequestAncillaryAugmented[](numUnresolved);
        for (uint256 i = 0; i < numUnresolved; i = unsafe_inc(i)) pendingRequests[i] = unresolved[i];

        return pendingRequests;
    }

    /**
     * @notice Checks if there are current active requests.
     * @return bool true if there are active requests, false otherwise.
     */
    function currentActiveRequests() public view returns (bool) {
        uint32 currentRoundId = getCurrentRoundId();
        for (uint256 i = 0; i < pendingPriceRequestsIds.length; i = unsafe_inc(i))
            if (_getRequestStatus(priceRequests[pendingPriceRequestsIds[i]], currentRoundId) == RequestStatus.Active)
                return true;

        return false;
    }

    /**
     * @notice Returns the current voting phase, as a function of the current time.
     * @return Phase to indicate the current phase. Either { Commit, Reveal, NUM_PHASES }.
     */
    function getVotePhase() public view override returns (Phase) {
        return Phase(uint256(voteTiming.computeCurrentPhase(getCurrentTime())));
    }

    /**
     * @notice Returns the current round ID, as a function of the current time.
     * @return uint32 the unique round ID.
     */
    function getCurrentRoundId() public view override returns (uint32) {
        return uint32(voteTiming.computeCurrentRoundId(getCurrentTime()));
    }

    /**
     * @notice Returns the round end time, as a function of the round number.
     * @param roundId representing the unique round ID.
     * @return uint256 representing the round end time.
     */
    function getRoundEndTime(uint256 roundId) external view returns (uint256) {
        return voteTiming.computeRoundEndTime(roundId);
    }

    /**
     * @notice Returns the number of current pending price requests to be voted and the number of resolved price
       requests over all time.
     * @dev This method might return stale values if the state of the contract has changed since the last time
       `processResolvablePriceRequests()` was called. To get the most up-to-date values, call
       `getNumberOfPriceRequestsPostUpdate()` instead.
     * @return numberPendingPriceRequests the total number of pending prices requests.
     * @return numberResolvedPriceRequests the total number of prices resolved over all time.
     */
    function getNumberOfPriceRequests()
        public
        view
        returns (uint256 numberPendingPriceRequests, uint256 numberResolvedPriceRequests)
    {
        return (pendingPriceRequestsIds.length, resolvedPriceRequestIds.length);
    }

    /**
     * @notice Returns the number of current pending price requests to be voted and the number of resolved price
       requests over all time after processing any resolvable price requests.
     * @return numberPendingPriceRequests the total number of pending prices requests.
     * @return numberResolvedPriceRequests the total number of prices resolved over all time.
     */
    function getNumberOfPriceRequestsPostUpdate()
        external
        returns (uint256 numberPendingPriceRequests, uint256 numberResolvedPriceRequests)
    {
        processResolvablePriceRequests();
        return getNumberOfPriceRequests();
    }

    /**
     * @notice Returns aggregate slashing trackers for a given request index.
     * @param requestIndex requestIndex the index of the request to fetch slashing trackers for.
     * @return SlashingTracker Tracker object contains the slashed UMA per staked UMA per wrong vote and no vote, the
     * total UMA slashed in the round and the total number of correct votes in the round.
     */
    function requestSlashingTrackers(uint256 requestIndex) public view returns (SlashingTracker memory) {
        PriceRequest storage priceRequest = priceRequests[resolvedPriceRequestIds[requestIndex]];
        uint32 lastVotingRound = priceRequest.lastVotingRound;
        VoteInstance storage voteInstance = priceRequest.voteInstances[lastVotingRound];

        uint256 totalVotes = voteInstance.results.totalVotes;
        uint256 totalCorrectVotes = voteInstance.results.getTotalCorrectlyVotedTokens();
        uint256 totalStaked = rounds[lastVotingRound].cumulativeStakeAtRound;

        (uint256 wrongVoteSlash, uint256 noVoteSlash) =
            rounds[lastVotingRound].slashingLibrary.calcSlashing(
                totalStaked,
                totalVotes,
                totalCorrectVotes,
                requestIndex,
                priceRequest.isGovernance
            );

        uint256 totalSlashed =
            ((noVoteSlash * (totalStaked - totalVotes)) + (wrongVoteSlash * (totalVotes - totalCorrectVotes))) / 1e18;

        return SlashingTracker(wrongVoteSlash, noVoteSlash, totalSlashed, totalCorrectVotes, lastVotingRound);
    }

    /**
     * @notice Returns the voter's participation in the vote for a given request index.
     * @param requestIndex requestIndex the index of the request to fetch slashing trackers for.
     * @param lastVotingRound the round to get voter participation for.
     * @param voter the voter to get participation for.
     * @return VoteParticipation enum representing the voter's participation in the vote.
     */
    function getVoterParticipation(
        uint256 requestIndex,
        uint32 lastVotingRound,
        address voter
    ) public view returns (VoteParticipation) {
        VoteInstance storage voteInstance =
            priceRequests[resolvedPriceRequestIds[requestIndex]].voteInstances[lastVotingRound];
        bytes32 revealHash = voteInstance.voteSubmissions[voter].revealHash;
        if (revealHash == bytes32(0)) return VoteParticipation.DidNotVote;
        if (voteInstance.results.wasVoteCorrect(revealHash)) return VoteParticipation.CorrectVote;
        return VoteParticipation.WrongVote;
    }

    /****************************************
     *        OWNER ADMIN FUNCTIONS         *
     ****************************************/

    /**
     * @notice Disables this Voting contract in favor of the migrated one.
     * @dev Can only be called by the contract owner.
     * @param newVotingAddress the newly migrated contract address.
     */
    function setMigrated(address newVotingAddress) external override onlyOwner {
        migratedAddress = newVotingAddress;
        emit VotingContractMigrated(newVotingAddress);
    }

    /**
     * @notice Sets the maximum number of rounds to roll a request can have before the DVM auto deletes it.
     * @dev Can only be called by the contract owner.
     * @param newMaxRolls the new number of rounds to roll a request before the DVM auto deletes it.
     */
    function setMaxRolls(uint32 newMaxRolls) public override onlyOwner {
        // Changes to max rolls can impact unresolved requests. To protect against this process requests first.
        processResolvablePriceRequests();
        maxRolls = newMaxRolls;
        emit MaxRollsChanged(newMaxRolls);
    }

    /**
     * @notice Sets the maximum number of requests that can be made in a single round. Used to bound the maximum
     * sequential slashing that can be applied within a single round.
     * @dev Can only be called by the contract owner.
     * @param newMaxRequestsPerRound the new maximum number of requests that can be made in a single round.
     */
    function setMaxRequestPerRound(uint32 newMaxRequestsPerRound) public override onlyOwner {
        require(newMaxRequestsPerRound > 0);
        maxRequestsPerRound = newMaxRequestsPerRound;
        emit MaxRequestsPerRoundChanged(newMaxRequestsPerRound);
    }

    /**
     * @notice Resets the GAT number and SPAT percentage. GAT is the minimum number of tokens that must participate in a
     * vote for it to resolve (quorum number). SPAT is the minimum percentage of tokens that must agree on a result
     * for it to resolve (percentage of staked tokens) This change only applies to subsequent rounds.
     * @param newGat sets the next round's GAT and going forward.
     * @param newSpat sets the next round's SPAT and going forward.
     */
    function setGatAndSpat(uint128 newGat, uint64 newSpat) public override onlyOwner {
        require(newGat < votingToken.totalSupply() && newGat > 0);
        require(newSpat > 0 && newSpat < 1e18);
        gat = newGat;
        spat = newSpat;

        emit GatAndSpatChanged(newGat, newSpat);
    }

    /**
     * @notice Changes the slashing library used by this contract.
     * @param _newSlashingLibrary new slashing library address.
     */
    function setSlashingLibrary(address _newSlashingLibrary) public override onlyOwner {
        slashingLibrary = SlashingLibraryInterface(_newSlashingLibrary);
        emit SlashingLibraryChanged(_newSlashingLibrary);
    }

    /****************************************
     *          STAKING FUNCTIONS           *
     ****************************************/

    /**
     * @notice Updates the voter's trackers for staking and slashing. Applies all unapplied slashing to given staker.
     * @dev Can be called by anyone, but it is not necessary for the contract to function is run the other functions.
     * @param voter address of the voter to update the trackers for.
     */
    function updateTrackers(address voter) external {
        _updateTrackers(voter);
    }

    /**
     * @notice Updates the voter's trackers for staking and voting, specifying a maximum number of resolved requests to
     * traverse. This function can be used in place of updateTrackers to process the trackers in batches, hence avoiding
     * potential issues if the number of elements to be processed is large and the associated gas cost is too high.
     * @param voter address of the voter to update the trackers for.
     * @param maxTraversals maximum number of resolved requests to traverse in this call.
     */
    function updateTrackersRange(address voter, uint64 maxTraversals) external {
        processResolvablePriceRequests();
        _updateAccountSlashingTrackers(voter, maxTraversals);
    }

    // Updates the global and selected wallet's trackers for staking and voting. Note that the order of these calls is
    // very important due to the interplay between slashing and inactive/active liquidity.
    function _updateTrackers(address voter) internal override {
        processResolvablePriceRequests();
        _updateAccountSlashingTrackers(voter, UINT64_MAX);
        super._updateTrackers(voter);
    }

    /**
     * @notice Process and resolve all resolvable price requests. This function traverses all pending price requests and
     *  resolves them if they are resolvable. It also rolls and deletes requests, if required.
     */
    function processResolvablePriceRequests() public {
        _processResolvablePriceRequests(UINT64_MAX);
    }

    /**
     * @notice Process and resolve all resolvable price requests. This function traverses all pending price requests and
     * resolves them if they are resolvable. It also rolls and deletes requests, if required. This function can be used
     * in place of processResolvablePriceRequests to process the requests in batches, hence avoiding potential issues if
     * the number of elements to be processed is large and the associated gas cost is too high.
     * @param maxTraversals maximum number of resolved requests to traverse in this call.
     */
    function processResolvablePriceRequestsRange(uint64 maxTraversals) external {
        _processResolvablePriceRequests(maxTraversals);
    }

    // Starting index for a staker is the first value that nextIndexToProcess is set to and defines the first index that
    // a staker is suspectable to receiving slashing on. This is set to current length of the resolvedPriceRequestIds.
    // Note first call processResolvablePriceRequests to ensure that the resolvedPriceRequestIds array is up to date.
    function _getStartingIndexForStaker() internal override returns (uint64) {
        processResolvablePriceRequests();
        return SafeCast.toUint64(resolvedPriceRequestIds.length);
    }

    // Checks if we are in an active voting reveal phase (currently revealing votes). This impacts if a new staker's
    // stake should be activated immediately or if it should be frozen until the end of the reveal phase.
    function _inActiveReveal() internal view override returns (bool) {
        return (currentActiveRequests() && getVotePhase() == Phase.Reveal);
    }

    // This function must be called before any tokens are staked. It updates the voter's pending stakes to reflect the
    // new amount to stake. These updates are only made if we are in an active reveal. This is required to appropriately
    // calculate a voter's trackers and avoid slashing them for amounts staked during an active reveal phase.
    function _computePendingStakes(address voter, uint128 amount) internal override {
        if (_inActiveReveal()) {
            uint32 currentRoundId = getCurrentRoundId();
            // Freeze round variables to prevent cumulativeActiveStakeAtRound from changing based on the stakes during
            // the active reveal phase. This will happen if the first action within the reveal is someone staking.
            _freezeRoundVariables(currentRoundId);
            // Increment pending stake for voter by amount. With the omission of stake from cumulativeActiveStakeAtRound
            // for this round, ensure that the pending stakes is not included in the slashing calculation for this round.
            _incrementPendingStake(voter, currentRoundId, amount);
        }
    }

    // Updates the slashing trackers of a given account based on previous voting activity. This traverses all resolved
    // requests for each voter and for each request checks if the voter voted correctly or not. Based on the voters
    // voting activity the voters balance is updated accordingly. The caller can provide a maxTraversals parameter to
    // limit the number of resolved requests to traverse in this call to bound the gas used. Note each iteration of
    // this function re-uses a fresh slash variable to produce useful logs on the amount a voter is slashed.
    function _updateAccountSlashingTrackers(address voter, uint64 maxTraversals) internal {
        VoterStake storage voterStake = voterStakes[voter];
        uint64 requestIndex = voterStake.nextIndexToProcess; // Traverse all requests from the last considered request.

        // Traverse all elements within the resolvedPriceRequestIds array and update the voter's trackers according to
        // their voting activity. Bound the number of iterations to the maxTraversals parameter to cap the gas used.
        while (requestIndex < resolvedPriceRequestIds.length && maxTraversals > 0) {
            maxTraversals = unsafe_dec_64(maxTraversals); // reduce the number of traversals left & re-use the prop.

            // Get the slashing for this request. This comes from the slashing library and informs to the voter slash.
            SlashingTracker memory trackers = requestSlashingTrackers(requestIndex);

            // Use the effective stake as the difference between the current stake and pending stake. The staker will
            //have a pending stake if they staked during an active reveal for the voting round in question.
            uint256 effectiveStake = voterStake.stake - voterStake.pendingStakes[trackers.lastVotingRound];
            int256 slash; // The amount to slash the voter by for this request. Reset on each entry to emit useful logs.

            // Get the voter participation for this request. This informs if the voter voted correctly or not.
            VoteParticipation participation = getVoterParticipation(requestIndex, trackers.lastVotingRound, voter);

            // The voter did not reveal or did not commit. Slash at noVote rate.
            if (participation == VoteParticipation.DidNotVote)
                slash = -int256(Math.ceilDiv(effectiveStake * trackers.noVoteSlashPerToken, 1e18));

                // The voter did not vote with the majority. Slash at wrongVote rate.
            else if (participation == VoteParticipation.WrongVote)
                slash = -int256(Math.ceilDiv(effectiveStake * trackers.wrongVoteSlashPerToken, 1e18));

                // Else, the voter voted correctly. Receive a pro-rate share of the other voters slash.
            else slash = int256((effectiveStake * trackers.totalSlashed) / trackers.totalCorrectVotes);

            emit VoterSlashed(voter, requestIndex, int128(slash));
            voterStake.unappliedSlash += int128(slash);

            // If the next round is different to the current considered round, apply the slash to the voter.
            if (isNextRequestRoundDifferent(requestIndex)) _applySlashToVoter(voterStake, voter);

            requestIndex = unsafe_inc_64(requestIndex); // Increment the request index.
        }

        // Set the account's nextIndexToProcess to the requestIndex so the next entry starts where we left off.
        voterStake.nextIndexToProcess = requestIndex;
    }

    // Applies a given slash to a given voter's stake. In the event the sum of the slash and the voter's stake is less
    // than 0, the voter's stake is set to 0 to prevent the voter's stake from going negative. unappliedSlash tracked
    // all slashing the staker has received but not yet applied to their stake. Apply it then set it to zero.
    function _applySlashToVoter(VoterStake storage voterStake, address voter) internal {
        if (voterStake.unappliedSlash + int128(voterStake.stake) > 0)
            voterStake.stake = uint128(int128(voterStake.stake) + voterStake.unappliedSlash);
        else voterStake.stake = 0;
        emit VoterSlashApplied(voter, voterStake.unappliedSlash, voterStake.stake);
        voterStake.unappliedSlash = 0;
    }

    // Checks if the next round (index+1) is different to the current round (index).
    function isNextRequestRoundDifferent(uint64 index) internal view returns (bool) {
        if (index + 1 >= resolvedPriceRequestIds.length) return true;

        return
            priceRequests[resolvedPriceRequestIds[index]].lastVotingRound !=
            priceRequests[resolvedPriceRequestIds[index + 1]].lastVotingRound;
    }

    /****************************************
     *      MIGRATION SUPPORT FUNCTIONS     *
     ****************************************/

    /**
     * @notice Enable retrieval of rewards on a previously migrated away from voting contract. This function is intended
     * on being removed from future versions of the Voting contract and aims to solve a short term migration pain point.
     * @param voter voter for which rewards will be retrieved. Does not have to be the caller.
     * @param roundId the round from which voting rewards will be retrieved from.
     * @param toRetrieve array of PendingRequests which rewards are retrieved from.
     * @return uint256 the amount of rewards.
     */
    function retrieveRewardsOnMigratedVotingContract(
        address voter,
        uint256 roundId,
        MinimumVotingAncillaryInterface.PendingRequestAncillary[] memory toRetrieve
    ) external returns (uint256) {
        uint256 rewards =
            MinimumVotingAncillaryInterface(address(previousVotingContract))
                .retrieveRewards(voter, roundId, toRetrieve)
                .rawValue;
        return rewards;
    }

    /****************************************
     *    PRIVATE AND INTERNAL FUNCTIONS    *
     ****************************************/

    // Deletes a request from the pending requests array, based on index. Swap and pop.
    function _removeRequestFromPendingPriceRequestsIds(uint64 pendingRequestIndex) internal {
        pendingPriceRequestsIds[pendingRequestIndex] = pendingPriceRequestsIds[pendingPriceRequestsIds.length - 1];
        pendingPriceRequestsIds.pop();
    }

    // Returns the price for a given identifier. Three params are returns: bool if there was an error, int to represent
    // the resolved price and a string which is filled with an error message, if there was an error or "".
    // This method considers actual request status that might be ahead of the stored contract state that gets updated
    // only after processResolvablePriceRequests() is called.
    function _getPriceOrError(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        internal
        view
        returns (
            bool,
            int256,
            string memory
        )
    {
        PriceRequest storage priceRequest = _getPriceRequest(identifier, time, ancillaryData);
        uint32 currentRoundId = getCurrentRoundId();
        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);

        if (requestStatus == RequestStatus.Active) return (false, 0, "Current voting round not ended");
        if (requestStatus == RequestStatus.Resolved) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (, int256 resolvedPrice) = _getResolvedPrice(voteInstance, priceRequest.lastVotingRound);
            return (true, resolvedPrice, "");
        }

        if (requestStatus == RequestStatus.Future) return (false, 0, "Price is still to be voted on");
        if (requestStatus == RequestStatus.ToDelete) return (false, 0, "Price will be deleted");
        (bool previouslyResolved, int256 previousPrice) =
            _getPriceFromPreviousVotingContract(identifier, time, ancillaryData);
        if (previouslyResolved) return (true, previousPrice, "");
        return (false, 0, "Price was never requested");
    }

    // Check the previousVotingContract to see if a given price request was resolved.
    // Returns true or false, and the resolved price or zero, depending on whether it was found or not.
    function _getPriceFromPreviousVotingContract(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) private view returns (bool, int256) {
        if (address(previousVotingContract) == address(0)) return (false, 0);
        if (previousVotingContract.hasPrice(identifier, time, ancillaryData))
            return (true, previousVotingContract.getPrice(identifier, time, ancillaryData));
        return (false, 0);
    }

    // Returns a price request object for a given identifier, time and ancillary data.
    function _getPriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) private view returns (PriceRequest storage) {
        return priceRequests[_encodePriceRequest(identifier, time, ancillaryData)];
    }

    // Returns an encoded bytes32 representing a price request. Used when storing/referencing price requests.
    function _encodePriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(identifier, time, ancillaryData));
    }

    // Stores ("freezes") variables that should not shift within an active voting round. Called on reveal but only makes
    // a state change if and only if the this is the first reveal.
    function _freezeRoundVariables(uint256 roundId) private {
        // Only freeze the round if this is the first request in the round.
        if (rounds[roundId].minParticipationRequirement == 0) {
            rounds[roundId].slashingLibrary = slashingLibrary;

            // The minimum required participation for a vote to settle within this round is the GAT (fixed number).
            rounds[roundId].minParticipationRequirement = gat;

            // The minimum votes on the modal outcome for the vote to settle within this round is the SPAT (percentage).
            rounds[roundId].minAgreementRequirement = uint128((spat * uint256(cumulativeStake)) / 1e18);
            rounds[roundId].cumulativeStakeAtRound = cumulativeStake; // Store the cumulativeStake to work slashing.
        }
    }

    // Traverse pending price requests and resolve any that are resolvable. If requests are rollable (they did not
    // resolve in the previous round and are to be voted in a subsequent round) then roll them. If requests can be
    // deleted (they have been rolled up to the maxRolls counter) then delete them. The caller can pass in maxTraversals
    // to limit the number of requests that are resolved in a single call to bound the total gas used by this function.
    // Note that the resolved index is stores for each round. This means that only the first caller of this function
    // per round needs to traverse the pending requests. After that subsequent calls to this are a no-op for that round.
    function _processResolvablePriceRequests(uint64 maxTraversals) private {
        uint32 currentRoundId = getCurrentRoundId();

        // Load in the last resolved index for this round to continue off from where the last caller left.
        uint64 requestIndex = lastRoundIdProcessed == currentRoundId ? nextPendingIndexToProcess : 0;
        // Traverse pendingPriceRequestsIds array and update the requests status according to the state of the request
        //(i.e settle, roll or delete request). Bound iterations to the maxTraversals parameter to cap the gas used.
        while (requestIndex < pendingPriceRequestsIds.length && maxTraversals > 0) {
            maxTraversals = unsafe_dec_64(maxTraversals);
            PriceRequest storage request = priceRequests[pendingPriceRequestsIds[requestIndex]];

            // If the last voting round is greater than or equal to the current round then this request is currently
            // being voted on or is enqueued for the next round. In this case, skip it and increment the request index.
            if (request.lastVotingRound >= currentRoundId) {
                requestIndex = unsafe_inc_64(requestIndex);
                continue; // Continue to the next request.
            }

            // Else, we are dealing with a request that can either be: a) deleted, b) rolled or c) resolved.
            VoteInstance storage voteInstance = request.voteInstances[request.lastVotingRound];
            (bool isResolvable, int256 resolvedPrice) = _getResolvedPrice(voteInstance, request.lastVotingRound);

            if (isResolvable) {
                // If resolvable, resolve. This involves a) moving the requestId from pendingPriceRequestsIds array to
                // resolvedPriceRequestIds array and b) removing requestId from pendingPriceRequestsIds. Don't need to
                // increment requestIndex as from pendingPriceRequestsIds amounts to decreasing the while loop bound.
                resolvedPriceRequestIds.push(pendingPriceRequestsIds[requestIndex]);
                _removeRequestFromPendingPriceRequestsIds(requestIndex);
                emit RequestResolved(
                    request.lastVotingRound,
                    resolvedPriceRequestIds.length - 1,
                    request.identifier,
                    request.time,
                    request.ancillaryData,
                    resolvedPrice
                );
                continue; // Continue to the next request.
            }
            // If not resolvable, but the round has passed its voting round, then it must be deleted or rolled. First,
            // increment the rollCount. Use the difference between the current round and the last voting round to
            // accommodate the contract not being touched for any number of rounds during the roll.
            request.rollCount += currentRoundId - request.lastVotingRound;

            // If the roll count exceeds the threshold and the request is not governance then it is deletable.
            if (_shouldDeleteRequest(request.rollCount, request.isGovernance)) {
                emit RequestDeleted(request.identifier, request.time, request.ancillaryData, request.rollCount);
                delete priceRequests[pendingPriceRequestsIds[requestIndex]];
                _removeRequestFromPendingPriceRequestsIds(requestIndex);
                continue;
            }
            // Else, the request should be rolled. This involves only moving forward the lastVotingRound.
            request.lastVotingRound = getRoundIdToVoteOnRequest(currentRoundId);
            ++rounds[request.lastVotingRound].numberOfRequestsToVote;
            emit RequestRolled(request.identifier, request.time, request.ancillaryData, request.rollCount);
            requestIndex = unsafe_inc_64(requestIndex);
        }

        lastRoundIdProcessed = currentRoundId; // Store the roundId that was processed.
        nextPendingIndexToProcess = requestIndex; // Store the index traversed up to for this round.
    }

    // Returns a price request status. A request is either: NotRequested, Active, Resolved, Future or ToDelete.
    function _getRequestStatus(PriceRequest storage priceRequest, uint32 currentRoundId)
        private
        view
        returns (RequestStatus)
    {
        if (priceRequest.lastVotingRound == 0) return RequestStatus.NotRequested;
        if (priceRequest.lastVotingRound < currentRoundId) {
            // Check if the request has already been resolved
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (bool isResolved, ) = _getResolvedPrice(voteInstance, priceRequest.lastVotingRound);
            if (isResolved) return RequestStatus.Resolved;
            if (_shouldDeleteRequest(_getActualRollCount(priceRequest, currentRoundId), priceRequest.isGovernance))
                return RequestStatus.ToDelete;
            return RequestStatus.Active;
        }
        if (priceRequest.lastVotingRound == currentRoundId) return RequestStatus.Active;

        return RequestStatus.Future; // Means than priceRequest.lastVotingRound > currentRoundId
    }

    function _getResolvedPrice(VoteInstance storage voteInstance, uint256 lastVotingRound)
        internal
        view
        returns (bool isResolved, int256 price)
    {
        return
            voteInstance.results.getResolvedPrice(
                rounds[lastVotingRound].minParticipationRequirement,
                rounds[lastVotingRound].minAgreementRequirement
            );
    }

    // Gas optimized uint256 increment.
    function unsafe_inc(uint256 x) internal pure returns (uint256) {
        unchecked { return x + 1; }
    }

    // Gas optimized uint64 increment.
    function unsafe_inc_64(uint64 x) internal pure returns (uint64) {
        unchecked { return x + 1; }
    }

    // Gas optimized uint64 decrement.
    function unsafe_dec_64(uint64 x) internal pure returns (uint64) {
        unchecked { return x - 1; }
    }

    // Returns the registered identifier whitelist, stored in the finder.
    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    // Reverts if the contract has been migrated. Used in a modifier, defined as a private function for gas savings.
    function _requireNotMigrated() private view {
        require(migratedAddress == address(0), "Contract migrated");
    }

    // Enforces that a calling contract is registered.
    function _requireRegisteredContract() private view {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(registry.isContractRegistered(msg.sender) || msg.sender == migratedAddress, "Caller not registered");
    }

    // Checks if a request should be deleted. A non-gevernance request should be deleted if it has been rolled more than
    // the maxRolls.
    function _shouldDeleteRequest(uint256 rollCount, bool isGovernance) private view returns (bool) {
        return rollCount > maxRolls && !isGovernance;
    }

    // Returns the actual roll count of a request. This is the roll count plus the number of rounds that have passed
    // since the last voting round.
    function _getActualRollCount(PriceRequest storage priceRequest, uint32 currentRoundId)
        private
        view
        returns (uint32)
    {
        if (currentRoundId <= priceRequest.lastVotingRound) return priceRequest.rollCount;
        return priceRequest.rollCount + currentRoundId - priceRequest.lastVotingRound;
    }
}
