// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

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
        mapping(uint256 => VoteInstance) voteInstances; // A map containing all votes for this price in various rounds.
        bytes ancillaryData; // Additional data used to resolve the request.
    }

    struct VoteInstance {
        mapping(address => VoteSubmission) voteSubmissions; // Maps (voterAddress) to their submission.
        ResultComputationV2.Data results; // The data structure containing the computed voting results.
    }

    struct VoteSubmission {
        bytes32 commit; // A bytes32 of 0 indicates no commit or a commit that was already revealed.
        bytes32 revealHash; // The hash of the value that was revealed. This is only used for computation of rewards.
    }

    struct Round {
        uint256 gat; // GAT(governance activation threshold) is the required number of tokens to resolve a vote.
        uint256 cumulativeStakeAtRound; // Total staked tokens at the start of the round.
        uint64 resolvedIndex; // Index of pendingPriceRequestsIds that has been traversed this round.
    }

    // Represents the status a price request has.
    enum RequestStatus {
        NotRequested, // Was never requested.
        Active, // Is being voted on in the current round.
        Resolved, // Was resolved in a previous round.
        Future // Is scheduled to be voted on in a future round.
    }

    // Only used as a return value in view methods -- never stored in the contract.
    struct RequestState {
        RequestStatus status;
        uint256 lastVotingRound;
    }

    // Only used as a return value in view methods -- never stored in the contract.
    struct SlashingTracker {
        uint256 wrongVoteSlashPerToken;
        uint256 noVoteSlashPerToken;
        uint256 totalSlashed;
        uint256 totalCorrectVotes;
    }

    /****************************************
     *            VOTING STATE              *
     ****************************************/

    mapping(uint256 => Round) public rounds; // Maps round numbers to the rounds.

    mapping(bytes32 => PriceRequest) public priceRequests; // Maps price request IDs to the PriceRequest struct.

    bytes32[] public resolvedPriceRequestIds; // Array of resolved price requestIds. Used to track resolved requests.

    bytes32[] public pendingPriceRequestsIds; // Array of pending price requestIds. Can be resolved in the future.

    uint32 public maxRolls; // The maximum number of times a request can roll before it is deleted automatically.

    FinderInterface private immutable finder; // Reference to the UMA Finder contract, used to find other UMA contracts.

    SlashingLibraryInterface public slashingLibrary; // Reference to Slashing Library, used to compute slashing amounts.

    VoteTiming.Data public voteTiming; // Vote timing library used to compute round timing related logic.

    OracleAncillaryInterface public immutable previousVotingContract; // Previous voting contract, if migrated.

    address public migratedAddress; // If non-zero, this contract has been migrated to this address.

    uint256 public gat; // Number of tokens that must participate to resolve a vote.

    uint64 private constant UINT64_MAX = type(uint64).max; // Max value of an unsigned integer.

    uint256 public constant ANCILLARY_BYTES_LIMIT = 8192; // Max length in bytes of ancillary data.

    /****************************************
     *                EVENTS                *
     ****************************************/

    event VoteCommitted(
        address indexed voter,
        address indexed caller,
        uint256 roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData
    );

    event EncryptedVote(
        address indexed caller,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        bytes encryptedVote
    );

    event VoteRevealed(
        address indexed voter,
        address indexed caller,
        uint256 roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price,
        uint256 numTokens
    );

    event RequestAdded(
        address indexed requester,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        bool isGovernance
    );

    event RequestResolved(
        uint256 indexed roundId,
        uint256 indexed resolvedPriceRequestIndex,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price
    );

    event VotingContractMigrated(address newAddress);

    event RequestDeleted(bytes32 indexed identifier, uint256 indexed time, bytes ancillaryData, uint256 rollCount);

    event RequestRolled(bytes32 indexed identifier, uint256 indexed time, bytes ancillaryData, uint256 rollCount);

    event GatChanged(uint256 newGat);

    event SlashingLibraryChanged(address newAddress);

    event MaxRollsChanged(uint32 newMaxRolls);

    event VoterSlashed(address indexed voter, int256 slashedTokens, uint256 postStake);

    /**
     * @notice Construct the VotingV2 contract.
     * @param _emissionRate amount of voting tokens that are emitted per second, split prorate between stakers.
     * @param _unstakeCoolDown time that a voter must wait to unstake after requesting to unstake.
     * @param _phaseLength length of the voting phases in seconds.
     * @param _maxRolls number of times a vote must roll to be auto deleted by the DVM.
     * @param _gat number of tokens that must participate to resolve a vote.
     * @param _votingToken address of the UMA token contract used to commit votes.
     * @param _finder keeps track of all contracts within the system based on their interfaceName.
     * @param _slashingLibrary contract used to calculate voting slashing penalties based on voter participation.
     * @param _previousVotingContract previous voting contract address.
     */
    constructor(
        uint256 _emissionRate,
        uint64 _unstakeCoolDown,
        uint64 _phaseLength,
        uint32 _maxRolls,
        uint256 _gat,
        address _votingToken,
        address _finder,
        address _slashingLibrary,
        address _previousVotingContract
    ) Staker(_emissionRate, _unstakeCoolDown, _votingToken) {
        voteTiming.init(_phaseLength);
        finder = FinderInterface(_finder);
        previousVotingContract = OracleAncillaryInterface(_previousVotingContract);
        setGat(_gat);
        setSlashingLibrary(_slashingLibrary);
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
    ) public override nonReentrant() onlyIfNotMigrated() onlyRegisteredContract() {
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
    ) external override onlyOwner() onlyIfNotMigrated() {
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
        uint64 time,
        bytes memory ancillaryData,
        bool isGovernance
    ) internal {
        uint256 blockTime = getCurrentTime();
        require(time <= blockTime, "Can only request in past");
        require(isGovernance || _getIdentifierWhitelist().isIdentifierSupported(identifier), "Unsupported identifier");
        require(ancillaryData.length <= ANCILLARY_BYTES_LIMIT, "Invalid ancillary data");

        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage priceRequest = priceRequests[priceRequestId];
        uint32 currentRoundId = uint32(getCurrentRoundId());

        // Price has never been requested.
        if (_getRequestStatus(priceRequest, currentRoundId) == RequestStatus.NotRequested) {
            uint32 roundIdToVoteOn = currentRoundId + 1; // Vote on request in the following round.
            priceRequests[priceRequestId].identifier = identifier;
            priceRequests[priceRequestId].time = time;
            priceRequests[priceRequestId].ancillaryData = ancillaryData;
            priceRequests[priceRequestId].lastVotingRound = roundIdToVoteOn;
            if (isGovernance) priceRequests[priceRequestId].isGovernance = isGovernance;

            pendingPriceRequestsIds.push(priceRequestId);
            emit RequestAdded(msg.sender, roundIdToVoteOn, identifier, time, ancillaryData, isGovernance);
        }
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
    ) public view override onlyRegisteredContract() returns (bool) {
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
    function hasPrice(bytes32 identifier, uint256 time) public view override returns (bool) {
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
    ) public view override onlyRegisteredContract() returns (int256) {
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
     * @notice Gets the status of a list of price requests, identified by their identifier and time.
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
        uint256 currentRoundId = getCurrentRoundId();
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
    ) public override nonReentrant() onlyIfNotMigrated() {
        uint256 currentRoundId = getCurrentRoundId();
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
    ) public override nonReentrant() onlyIfNotMigrated() {
        uint256 currentRoundId = getCurrentRoundId();
        _freezeRoundVariables(currentRoundId);
        VoteInstance storage voteInstance =
            _getPriceRequest(identifier, time, ancillaryData).voteInstances[currentRoundId];
        address voter = getVoterFromDelegate(msg.sender);
        VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[voter];

        require(getVotePhase() == Phase.Reveal, "Reveal phase has not started yet"); // Can only reveal in reveal phase.

        // 0 hashes are blocked in commit, so they indicate a different error: voter did not commit or already revealed.
        require(voteSubmission.commit != bytes32(0), "Invalid hash reveal");

        // Check that the hash that was committed matches to the one that was revealed. Note that if the voter had
        // delegated this means that they must reveal with the same account they had committed with.
        require(
            keccak256(abi.encodePacked(price, salt, msg.sender, time, ancillaryData, currentRoundId, identifier)) ==
                voteSubmission.commit,
            "Revealed data != commit hash"
        );

        delete voteSubmission.commit; // Small gas refund for clearing up storage.

        voteSubmission.revealHash = keccak256(abi.encode(price)); // Set the voter's submission.

        uint256 effectiveStake = voterStakes[voter].stake - voterStakes[voter].pendingStakes[currentRoundId];
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
     * @notice Gets the queries that are being voted on this round.
     * @return pendingRequests array containing identifiers of type PendingRequestAncillary.
     */
    function getPendingRequests() external view override returns (PendingRequestAncillaryAugmented[] memory) {
        // Solidity memory arrays aren't resizable (and reading storage is expensive). Hence this hackery to filter
        // pendingPriceRequestsIds only to those requests that have an Active RequestStatus.
        PendingRequestAncillaryAugmented[] memory unresolved =
            new PendingRequestAncillaryAugmented[](pendingPriceRequestsIds.length);
        uint256 numUnresolved = 0;

        for (uint256 i = 0; i < pendingPriceRequestsIds.length; i = unsafe_inc(i)) {
            PriceRequest storage priceRequest = priceRequests[pendingPriceRequestsIds[i]];

            if (_getRequestStatus(priceRequest, getCurrentRoundId()) == RequestStatus.Active) {
                unresolved[numUnresolved] = PendingRequestAncillaryAugmented({
                    identifier: priceRequest.identifier,
                    time: priceRequest.time,
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
        uint256 currentRoundId = getCurrentRoundId();
        for (uint256 i = 0; i < pendingPriceRequestsIds.length; i = unsafe_inc(i)) {
            if (_getRequestStatus(priceRequests[pendingPriceRequestsIds[i]], currentRoundId) == RequestStatus.Active)
                return true;
        }
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
     * @return uint256 the unique round ID.
     */
    function getCurrentRoundId() public view override returns (uint256) {
        return voteTiming.computeCurrentRoundId(getCurrentTime());
    }

    /**
     * @notice Returns the round end time, as a function of the round number.
     * @param roundId representing the unique round ID.
     * @return uint256 representing the unique round ID.
     */
    function getRoundEndTime(uint256 roundId) external view returns (uint256) {
        return voteTiming.computeRoundEndTime(roundId);
    }

    /**
     * @notice Returns the number of resolved price requests over all time.
     * @return uint256 the total number of prices resolved over all time.
     */
    function getNumberOfResolvedPriceRequests() external view returns (uint256) {
        return resolvedPriceRequestIds.length;
    }

    /**
     * @notice Returns the number of current pending price requests to be voted.
     * @return uint256 the total number of pending prices requests.
     */
    function getNumberOfPendingPriceRequests() external view returns (uint256) {
        return pendingPriceRequestsIds.length;
    }

    /**
     * @notice Returns aggregate slashing trackers for a given request index.
     * @param requestIndex requestIndex the index of the request to fetch slashing trackers for.
     * @return SlashingTracker Tracker object contains the slashed UMA per staked UMA per wrong vote and no vote, the
     * total UMA slashed in the round and the total number of correct votes in the round.
     */
    function requestSlashingTrackers(uint256 requestIndex) public view returns (SlashingTracker memory) {
        uint256 currentRoundId = getCurrentRoundId();
        PriceRequest storage priceRequest = priceRequests[resolvedPriceRequestIds[requestIndex]];

        // If the request is not resolved return zeros for everything.
        if (_getRequestStatus(priceRequest, currentRoundId) != RequestStatus.Resolved)
            return SlashingTracker(0, 0, 0, 0);

        VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];

        uint256 totalVotes = voteInstance.results.totalVotes;
        uint256 totalCorrectVotes = voteInstance.results.getTotalCorrectlyVotedTokens();
        uint256 stakedAtRound = rounds[priceRequest.lastVotingRound].cumulativeStakeAtRound;

        (uint256 wrongVoteSlash, uint256 noVoteSlash) =
            slashingLibrary.calcSlashing(stakedAtRound, totalVotes, totalCorrectVotes, priceRequest.isGovernance);

        uint256 totalSlashed =
            ((noVoteSlash * (stakedAtRound - totalVotes)) / 1e18) +
                ((wrongVoteSlash * (totalVotes - totalCorrectVotes)) / 1e18);

        return SlashingTracker(wrongVoteSlash, noVoteSlash, totalSlashed, totalCorrectVotes);
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
        require(newMaxRolls > 0, "Cannot set to 0");
        maxRolls = newMaxRolls;
        emit MaxRollsChanged(newMaxRolls);
    }

    /**
     * @notice Resets the Gat percentage. Note: this change only applies to rounds that have not yet begun.
     * @param newGat sets the next round's Gat.
     */
    function setGat(uint256 newGat) public override onlyOwner {
        require(newGat < votingToken.totalSupply() && newGat > 0);
        gat = newGat;
        emit GatChanged(newGat);
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
     * @notice Updates the voter's trackers for staking and slashing.
     * @dev This function can be called by anyone, but it is not necessary for the contract to work because
     * it is automatically run in the other functions.
     * @param voterAddress address of the voter to update the trackers for.
     */
    function updateTrackers(address voterAddress) external {
        _updateTrackers(voterAddress);
    }

    /**
     * @notice Updates the voter's trackers for staking and voting, specifying a maximum number of resolved requests to
     * traverse. This function can be used in place of updateTrackers to process the trackers in batches, hence avoiding
     * potential issues if the number of elements to be processed is large and the associated gas cost is too high.
     * @param voterAddress address of the voter to update the trackers for.
     * @param maxTraversals maximum number of resolved requests to traverse in this call.
     */
    function updateTrackersRange(address voterAddress, uint64 maxTraversals) external {
        resolveResolvablePriceRequests();
        _updateAccountSlashingTrackers(voterAddress, maxTraversals);
    }

    /**
     * @notice Resolves all resolvable price requests. This function traverses all pending price requests and resolves
     * them if they are resolvable. It also rolls requests, if needed and deletes requests, if required.
     */
    function resolveResolvablePriceRequests() public {
        _resolveResolvablePriceRequests(UINT64_MAX);
    }

    /**
     * @notice Resolves all resolvable price requests, specifying a maximum number of resolved requests to traverse.
     * @param maxTraversals maximum number of resolved requests to traverse in this call.
     */
    function resolveResolvablePriceRequestsRange(uint64 maxTraversals) external {
        _resolveResolvablePriceRequests(maxTraversals);
    }

    // Updates the global and selected wallet's trackers for staking and voting. Note that the order of these calls is
    // very important due to the interplay between slashing and inactive/active liquidity.
    function _updateTrackers(address voterAddress) internal override {
        resolveResolvablePriceRequests();
        _updateAccountSlashingTrackers(voterAddress, UINT64_MAX);
        super._updateTrackers(voterAddress);
    }

    // Starting index for a staker is the first value that nextIndexToProcess is set to and defines the first index that
    // a staker is suspectable to receiving slashing on. This is set to current length of the resolvedPriceRequestIds.
    // Note first call resolveResolvablePriceRequests to ensure that the resolvedPriceRequestIds array is up to date.
    function _getStartingIndexForStaker() internal override returns (uint64) {
        resolveResolvablePriceRequests();
        return SafeCast.toUint64(resolvedPriceRequestIds.length);
    }

    // Checks if we are in an active voting reveal phase (currently revealing votes).
    function _inActiveReveal() internal view override returns (bool) {
        return (currentActiveRequests() && getVotePhase() == Phase.Reveal);
    }

    // This function must be called before any tokens are staked. It updates the voter's pending stakes to reflect the
    // new amount to stake. These updates are only made if we are in an active reveal. This is required to appropriately
    // calculate a voter's trackers and avoid slashing them for amounts staked during an active reveal phase.
    function _computePendingStakes(address voterAddress, uint256 amount) internal override {
        if (_inActiveReveal()) {
            uint256 currentRoundId = getCurrentRoundId();
            // Now freeze the round variables as we do not want the cumulativeActiveStakeAtRound to change based on the
            // stakes during the active reveal phase. This only happens if the first action within the active reveal is
            // someone staking, rather than someone revealing their vote.
            _freezeRoundVariables(currentRoundId);
            // Finally increment the pending stake for the voter by the amount to stake. Together with the omission of
            // the new stakes from the cumulativeActiveStakeAtRound for this round, this ensures that the pending stakes
            // of any voter are not included in the slashing calculation for this round.
            _setPendingStake(voterAddress, currentRoundId, amount);
        }
    }

    // Updates the slashing trackers of a given account based on previous voting activity. This traverses all resolved
    // requests for each voter and for each request checks if the voter voted correctly or not. Based on the voters
    // voting activity the voters balance is updated accordingly. The caller can provide a maxTraversals parameter to
    // limit the number of resolved requests to traverse in this call. This is useful if the number of resolved requests
    // is large and the update needs to be split over multiple transactions.
    function _updateAccountSlashingTrackers(address voterAddress, uint64 maxTraversals) internal {
        VoterStake storage voterStake = voterStakes[voterAddress];
        int256 slash = voterStake.unappliedSlash; // Load in any unapplied slashing from the previous iteration.
        uint64 requestIndex = voterStake.nextIndexToProcess; // Traverse all requests from the last considered request.
        // TODO: add a comment explaining how this while loop works
        while (requestIndex < resolvedPriceRequestIds.length && maxTraversals > 0) {
            maxTraversals = unsafe_dec_64(maxTraversals); // reduce the number of traversals left & re-use the prop.

            PriceRequest storage request = priceRequests[resolvedPriceRequestIds[requestIndex]];
            VoteInstance storage vote = request.voteInstances[request.lastVotingRound];

            uint256 totalStaked = rounds[request.lastVotingRound].cumulativeStakeAtRound;
            uint256 totalVotes = vote.results.totalVotes;
            uint256 totalCorrectVotes = vote.results.getTotalCorrectlyVotedTokens();

            // Calculate aggregate metrics for this round.
            (uint256 wrongVoteSlashPerToken, uint256 noVoteSlashPerToken) =
                slashingLibrary.calcSlashing(totalStaked, totalVotes, totalCorrectVotes, request.isGovernance);

            // Use the effective stake as the difference between the current stake and pending stake. They will having
            // pending stake if they staked during an active reveal for the voting round in question.
            uint256 effectiveStake = voterStake.stake - voterStake.pendingStakes[request.lastVotingRound];

            // The voter did not reveal or did not commit. Slash at noVote rate.
            if (vote.voteSubmissions[voterAddress].revealHash == 0)
                slash -= int256((effectiveStake * noVoteSlashPerToken) / 1e18);

                // The voter did not vote with the majority. Slash at wrongVote rate.
            else if (!vote.results.wasVoteCorrect(vote.voteSubmissions[voterAddress].revealHash))
                slash -= int256((effectiveStake * wrongVoteSlashPerToken) / 1e18);

                // The voter voted correctly. Receive a pro-rate share of the other voters slashed amounts as a reward.
            else {
                // Compute the total amount slashed over all stakers. This is the sum of total slashed for not voting
                // and the total slashed for voting incorrectly. Use this to work out the stakers prorate share.
                uint256 totalSlashed =
                    ((noVoteSlashPerToken * (totalStaked - totalVotes)) +
                        (wrongVoteSlashPerToken * (totalVotes - totalCorrectVotes))) / 1e18;
                slash += int256((effectiveStake * totalSlashed) / totalCorrectVotes);
            }

            // If the next round is different to the current considered round, apply the slash to the voter and set the
            // slash to 0. By doing this each request within a round is slashed independently of one another.
            if (isNextRequestRoundDifferent(requestIndex)) {
                _applySlashToVoter(slash, voterStake, voterAddress);
                slash = 0;
            }
            requestIndex = unsafe_inc_64(requestIndex); // Increment the request index.
        }

        // Once we've traversed all requests, apply any remaining slash to the voter. This would be the case if the we
        // had not traversed all settled requests in the above loop due to the maxTraversals parameter. If the following
        // request round is the same as the current round and we have an unapplied slash then store it within the voters
        // unappliedSlash tracker so that the next iteration of this method continues off from where we end now.
        if (slash != 0 && !isNextRequestRoundDifferent(requestIndex - 1)) voterStake.unappliedSlash = slash;

        // Set the account's next index to process to the next index so the next entry starts where we left off.
        voterStake.nextIndexToProcess = requestIndex;
    }

    // Applies a given slash to a given voter's stake.
    function _applySlashToVoter(
        int256 slash,
        VoterStake storage voterStake,
        address voterAddress
    ) internal {
        if (slash + int256(voterStake.stake) > 0) voterStake.stake = uint256(int256(voterStake.stake) + slash);
        else voterStake.stake = 0;
        voterStake.unappliedSlash = 0;
        emit VoterSlashed(voterAddress, slash, voterStake.stake);
    }

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
     * @param voterAddress voter for which rewards will be retrieved. Does not have to be the caller.
     * @param roundId the round from which voting rewards will be retrieved from.
     * @param toRetrieve array of PendingRequests which rewards are retrieved from.
     * @return uint256 the amount of rewards.
     */
    function retrieveRewardsOnMigratedVotingContract(
        address voterAddress,
        uint256 roundId,
        MinimumVotingAncillaryInterface.PendingRequestAncillary[] memory toRetrieve
    ) public returns (uint256) {
        uint256 rewards =
            MinimumVotingAncillaryInterface(address(previousVotingContract))
                .retrieveRewards(voterAddress, roundId, toRetrieve)
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
        uint256 currentRoundId = getCurrentRoundId();
        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);

        if (requestStatus == RequestStatus.Active) return (false, 0, "Current voting round not ended");
        if (requestStatus == RequestStatus.Resolved) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (, int256 resolvedPrice) = voteInstance.results.getResolvedPrice(_computeGat(priceRequest.lastVotingRound));
            return (true, resolvedPrice, "");
        }

        if (requestStatus == RequestStatus.Future) return (false, 0, "Price is still to be voted on");
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
        if (rounds[roundId].gat == 0) {
            rounds[roundId].gat = gat; // Set the round gat percentage to the current global gat rate.
            rounds[roundId].cumulativeStakeAtRound = cumulativeStake; // Store the cumulativeStake to work slashing.
        }
    }

    // Traverse pending price requests and resolve any that are resolvable. If requests are rollable (they did not
    // resolve in the previous round and are to be voted in a subsequent round) then roll them. If requests can be
    // deleted (they have been rolled up to the maxRolls counter) then delete them. The caller can pass in maxTraversals
    // to limit the number of requests that are resolved in a single call to bound the total gas used by this function.
    // Note that the resolved index is stores for each round. This means that only the first caller of this function
    // per round needs to traverse the pending requests. After that subsequent calls to this are a no-op for that round.
    function _resolveResolvablePriceRequests(uint64 maxTraversals) private {
        uint32 currentRoundId = uint32(getCurrentRoundId());

        // Load in the last resolved index for this round to continue off from where the last caller left.
        uint64 requestIndex = rounds[currentRoundId].resolvedIndex;
        //TODO: improve this comment Traverse over all pending requests, bounded by maxTraversals.
        while (requestIndex < pendingPriceRequestsIds.length && maxTraversals > 0) {
            maxTraversals = unsafe_dec_64(maxTraversals);

            PriceRequest storage request = priceRequests[pendingPriceRequestsIds[requestIndex]];
            // If the last voting round is greater than or equal to the current round then this request is currently
            // being voted on or is endued for the next round. In that case, skip it and increment the request index.
            if (request.lastVotingRound >= currentRoundId) {
                requestIndex = unsafe_inc_64(requestIndex);
                continue;
            }
            VoteInstance storage voteInstance = request.voteInstances[request.lastVotingRound];
            (bool isResolvable, int256 resolvedPrice) =
                voteInstance.results.getResolvedPrice(_computeGat(request.lastVotingRound));

            // If a request is not resolvable, but the round has passed its voting round, then it is either rollable or
            // deletable (if it has rolled enough times.)
            if (!isResolvable) {
                // Increment the rollCount. Use the difference between the current round and the last voting round to
                // accommodate the contract not being touched for a few rounds during the roll.
                request.rollCount += currentRoundId - request.lastVotingRound;
                // If the roll count exceeds the threshold and the request is not governance then it is deletable.
                if (request.rollCount > maxRolls && !request.isGovernance) {
                    emit RequestDeleted(request.identifier, request.time, request.ancillaryData, request.rollCount);
                    delete priceRequests[pendingPriceRequestsIds[requestIndex]];
                    _removeRequestFromPendingPriceRequestsIds(SafeCast.toUint64(requestIndex));
                } else {
                    // Else, the request should be rolled. This involves only moving forward the lastVotingRound.
                    request.lastVotingRound = currentRoundId;
                    emit RequestRolled(request.identifier, request.time, request.ancillaryData, request.rollCount);
                    requestIndex = unsafe_inc_64(requestIndex);
                }
                continue; // Continue to the next request.
            }

            // Else, if we got here then the request is resolvable. Resolve it. This involves removing the request Id
            // from the pendingPriceRequestsIds array to the resolvedPriceRequestIds array and removing it from the
            // pendingPriceRequestsIds. Note we dont need to increment the requestIndex here because we are removing
            // the element from the pendingPriceRequestsIds which amounts to decreasing the overall while loop bound.
            resolvedPriceRequestIds.push(pendingPriceRequestsIds[requestIndex]);
            _removeRequestFromPendingPriceRequestsIds(SafeCast.toUint64(requestIndex));

            emit RequestResolved(
                request.lastVotingRound,
                resolvedPriceRequestIds.length - 1,
                request.identifier,
                request.time,
                request.ancillaryData,
                resolvedPrice
            );
        }
        rounds[currentRoundId].resolvedIndex = requestIndex; // Store the index traversed up to for this round.
    }

    // Return the GAT: the minimum number of tokens needed to participate to resolve a vote.
    function _computeGat(uint256 roundId) internal view returns (uint256) {
        return rounds[roundId].gat;
    }

    // Returns a price request status. A request is either: NotRequested, Active, Resolved or Future.
    function _getRequestStatus(PriceRequest storage priceRequest, uint256 currentRoundId)
        private
        view
        returns (RequestStatus)
    {
        if (priceRequest.lastVotingRound == 0) return RequestStatus.NotRequested;
        else if (priceRequest.lastVotingRound < currentRoundId) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (bool isResolved, ) = voteInstance.results.getResolvedPrice(_computeGat(priceRequest.lastVotingRound));

            return isResolved ? RequestStatus.Resolved : RequestStatus.Active;
        } else if (priceRequest.lastVotingRound == currentRoundId) return RequestStatus.Active;
        // Means than priceRequest.lastVotingRound > currentRoundId
        else return RequestStatus.Future;
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
        require(
            registry.isContractRegistered(msg.sender) || msg.sender == migratedAddress,
            "Caller must be registered"
        );
    }
}
