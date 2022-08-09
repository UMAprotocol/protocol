// TODO: this whole /oracle/implementation directory should be restructured to separate the DVM and the OO.

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.15;

import "../../common/implementation/MultiCaller.sol";

import "../interfaces/FinderInterface.sol";
import "../interfaces/IdentifierWhitelistInterface.sol";
import "../interfaces/OracleAncillaryInterface.sol";
import "../interfaces/OracleGovernanceInterface.sol";
import "../interfaces/OracleInterface.sol";
import "../interfaces/VotingV2Interface.sol";
import "./Constants.sol";
import "./Registry.sol";
import "./ResultComputationV2.sol";
import "./SlashingLibrary.sol";
import "./SpamGuardIdentifierLib.sol";
import "./Staker.sol";
import "./VoteTimingV2.sol";

import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title VotingV2 contract for the UMA DVM.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting schelling scheme.
 */

contract VotingV2 is
    Staker,
    OracleInterface,
    OracleAncillaryInterface,
    OracleGovernanceInterface,
    VotingV2Interface,
    MultiCaller
{
    using VoteTimingV2 for VoteTimingV2.Data;
    using ResultComputationV2 for ResultComputationV2.Data;

    /****************************************
     *        VOTING DATA STRUCTURES        *
     ****************************************/

    // Identifies a unique price request. Tracks ongoing votes as well as the result of the vote.
    struct PriceRequest {
        // If in the past, this was the voting round where this price was resolved. If current or the upcoming round,
        // this is the voting round where this price will be voted on, but not necessarily resolved.
        uint32 lastVotingRound;
        // Denotes whether this is a governance request or not.
        bool isGovernance;
        // The pendingRequestIndex in the pendingPriceRequests that references this PriceRequest. A value of UINT64_MAX
        // means that this PriceRequest is resolved and has been cleaned up from pendingPriceRequests.
        uint64 pendingRequestIndex;
        // Each request has a unique requestIndex number that is used to order all requests. This is the index within
        // the priceRequestIds array and is incremented on each request.
        uint64 priceRequestIndex;
        // Timestamp that should be used when evaluating the request.
        // Note: this is a uint64 to allow better variable packing while still leaving more than ample room for
        // timestamps to stretch far into the future.
        uint64 time;
        // Identifier that defines how the voters should resolve the request.
        bytes32 identifier;
        // A map containing all votes for this price in various rounds.
        mapping(uint256 => VoteInstance) voteInstances;
        // Additional data used to resolve the request.
        bytes ancillaryData;
    }

    struct VoteInstance {
        mapping(address => VoteSubmission) voteSubmissions; // Maps (voterAddress) to their submission.
        ResultComputationV2.Data resultComputation; // The data structure containing the computed voting results.
    }

    struct VoteSubmission {
        bytes32 commit; // A bytes32 of 0 indicates no commit or a commit that was already revealed.
        bytes32 revealHash; // The hash of the value that was revealed. This is only used for computation of rewards.
    }

    struct Round {
        uint256 gat; // GAT is the required number of tokens to vote to not roll the vote.
        uint256 cumulativeActiveStakeAtRound; // Total staked tokens at the start of the round.
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

    /****************************************
     *          INTERNAL TRACKING           *
     ****************************************/

    // Maps round numbers to the rounds.
    mapping(uint256 => Round) public rounds;

    // Maps price request IDs to the PriceRequest struct.
    mapping(bytes32 => PriceRequest) public priceRequests;

    bytes32[] public priceRequestIds;

    mapping(uint64 => uint64) public skippedRequestIndexes;

    // Price request ids for price requests that haven't yet been resolved. These requests may be for future rounds.
    bytes32[] public pendingPriceRequests;

    VoteTimingV2.Data public voteTiming;

    // Number of tokens that must participate to resolve a vote.
    uint256 public gat;

    // Reference to the Finder.
    FinderInterface public immutable finder;

    // Reference to Slashing Library.
    SlashingLibrary public slashingLibrary;

    // If non-zero, this contract has been migrated to this address.
    address public migratedAddress;

    // Max value of an unsigned integer.
    uint64 private constant UINT64_MAX = type(uint64).max;

    // Max length in bytes of ancillary data that can be appended to a price request.
    uint256 public constant ANCILLARY_BYTES_LIMIT = 8192;

    /****************************************
     *          SLASHING TRACKERS           *
     ****************************************/

    // Only used as a return value in view methods -- never stored in the contract.
    struct SlashingTracker {
        uint256 wrongVoteSlashPerToken;
        uint256 noVoteSlashPerToken;
        uint256 totalSlashed;
        uint256 totalCorrectVotes;
    }

    /****************************************
     *        SPAM DELETION TRACKERS        *
     ****************************************/

    uint256 public spamDeletionProposalBond;

    struct SpamDeletionRequest {
        uint256[2][] spamRequestIndices;
        uint256 requestTime;
        bool executed;
        address proposer;
        uint256 bond;
    }

    SpamDeletionRequest[] public spamDeletionProposals;

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
        int256 price,
        bytes ancillaryData,
        uint256 numTokens
    );

    event PriceRequestAdded(
        address indexed requester,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        uint256 requestIndex,
        bytes ancillaryData,
        bool isGovernance
    );

    event PriceResolved(
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        uint256 requestIndex,
        int256 price,
        bytes ancillaryData
    );

    event VotingContractMigrated(address newAddress);

    event GatChanged(uint256 newGat);

    event SlashingLibraryChanged(address newAddress);

    event SpamDeletionProposalBondChanged(uint256 newBond);

    event VoterSlashed(address indexed voter, int256 slashedTokens, uint256 postActiveStake);

    event SignaledRequestsAsSpamForDeletion(
        uint256 indexed proposalId,
        address indexed sender,
        uint256[2][] spamRequestIndices
    );

    event ExecutedSpamDeletion(uint256 indexed proposalId, bool indexed executed);

    /**
     * @notice Construct the VotingV2 contract.
     * @param _emissionRate amount of voting tokens that are emitted per second, split prorate between stakers.
     * @param _unstakeCoolDown time that a voter must wait to unstake after requesting to unstake.
     * @param _phaseLength length of the voting phases in seconds.
     * @param _minRollToNextRoundLength time before the end of a round in which a request must be made for the request
     *  to be voted on in the next round. If after this, the request is rolled to a round after the next round.
     * @param _gat number of tokens that must participate to resolve a vote.
     * @param _votingToken address of the UMA token contract used to commit votes.
     * @param _finder keeps track of all contracts within the system based on their interfaceName.
     * Must be set to 0x0 for production environments that use live time.
     * @param _slashingLibrary contract used to calculate voting slashing penalties based on voter participation.
     */
    constructor(
        uint256 _emissionRate,
        uint256 _spamDeletionProposalBond,
        uint64 _unstakeCoolDown,
        uint64 _phaseLength,
        uint64 _minRollToNextRoundLength,
        uint256 _gat,
        uint64 _startingRequestIndex,
        address _votingToken,
        address _finder,
        address _slashingLibrary
    ) Staker(_emissionRate, _unstakeCoolDown, _votingToken) {
        voteTiming.init(_phaseLength, _minRollToNextRoundLength);
        require(_gat < IERC20(_votingToken).totalSupply() && _gat > 0, "0 < GAT < total supply");
        gat = _gat;
        finder = FinderInterface(_finder);
        slashingLibrary = SlashingLibrary(_slashingLibrary);
        setSpamDeletionProposalBond(_spamDeletionProposalBond);

        // We assume indices never get above 2^64. So we should never start with an index above half that range.
        require(_startingRequestIndex < type(uint64).max / 2, "startingRequestIndex too large");

        assembly {
            sstore(priceRequestIds.slot, _startingRequestIndex)
        }
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
     * @notice Enqueues a request (if a request isn't already present) for the identifier, time pair.
     * @dev Time must be in the past and the identifier must be supported. The length of the ancillary data
     * is limited such that this method abides by the EVM transaction gas limit.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp for the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override onlyIfNotMigrated() onlyRegisteredContract() {
        _requestPrice(identifier, time, ancillaryData, false);
    }

    /**
     * @notice Enqueues a governance action request (if a request isn't already present) for identifier, time pair.
     * @dev Time must be in the past and the identifier must be supported. The length of the ancillary data
     * is limited such that this method abides by the EVM transaction gas limit.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp for the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     */
    function requestGovernanceAction(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) external override onlyOwner() {
        _requestPrice(identifier, time, ancillaryData, true);
    }

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given identifier, time pair.
     * @dev Time must be in the past and the identifier must be supported. The length of the ancillary data is limited
     * such that this method abides by the EVM transaction gas limit.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp for the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param isGovernance indicates whether the request is for a governance action.
     */
    function _requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool isGovernance
    ) internal {
        uint256 blockTime = getCurrentTime();
        require(time <= blockTime, "Can only request in past");
        require(
            isGovernance || _getIdentifierWhitelist().isIdentifierSupported(identifier),
            "Unsupported identifier request"
        );
        require(ancillaryData.length <= ANCILLARY_BYTES_LIMIT, "Invalid ancillary data");

        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage priceRequest = priceRequests[priceRequestId];
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);

        // Price has never been requested.
        if (requestStatus == RequestStatus.NotRequested) {
            // If the price request is a governance action then always place it in the following round. If the price
            // request is a normal request then either place it in the next round or the following round based off
            // the minRollToNextRoundLength. This limits when a request must be made for it to occur in the next round.
            uint256 roundIdToVoteOnPriceRequest =
                isGovernance ? currentRoundId + 1 : voteTiming.computeRoundToVoteOnPriceRequest(blockTime);
            PriceRequest storage newPriceRequest = priceRequests[priceRequestId];
            newPriceRequest.identifier = identifier;
            newPriceRequest.time = SafeCast.toUint64(time);
            newPriceRequest.lastVotingRound = SafeCast.toUint32(roundIdToVoteOnPriceRequest);
            newPriceRequest.pendingRequestIndex = SafeCast.toUint64(pendingPriceRequests.length);
            newPriceRequest.priceRequestIndex = SafeCast.toUint64(priceRequestIds.length);
            newPriceRequest.ancillaryData = ancillaryData;
            if (isGovernance) newPriceRequest.isGovernance = isGovernance;

            pendingPriceRequests.push(priceRequestId);
            priceRequestIds.push(priceRequestId);

            emit PriceRequestAdded(
                msg.sender,
                roundIdToVoteOnPriceRequest,
                identifier,
                time,
                newPriceRequest.priceRequestIndex,
                ancillaryData,
                isGovernance
            );
        }
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function requestPrice(bytes32 identifier, uint256 time) external override {
        requestPrice(identifier, time, "");
    }

    /**
     * @notice Whether the price for identifier and time is available.
     * @dev Time must be in the past and the identifier must be supported.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @return _hasPrice bool if the DVM has resolved to a price for the given identifier and timestamp.
     */
    function hasPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override onlyRegisteredContract() returns (bool) {
        (bool _hasPrice, , ) = _getPriceOrError(identifier, time, ancillaryData);
        return _hasPrice;
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function hasPrice(bytes32 identifier, uint256 time) public view override returns (bool) {
        return hasPrice(identifier, time, "");
    }

    /**
     * @notice Gets the price for identifier and time if it has already been requested and resolved.
     * @dev If the price is not available, the method reverts.
     * @param identifier uniquely identifies the price requested. E.g. BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @return int256 representing the resolved price for the given identifier and timestamp.
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

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function getPrice(bytes32 identifier, uint256 time) external view override returns (int256) {
        return getPrice(identifier, time, "");
    }

    /**
     * @notice Gets the status of a list of price requests, identified by their identifier and time.
     * @dev If the status for a particular request is NotRequested, the lastVotingRound will always be 0.
     * @param requests array of type PendingRequestAncillary which includes an identifier and timestamp for each request.
     * @return requestStates a list, in the same order as the input list, giving the status of each of the specified price requests.
     */
    function getPriceRequestStatuses(PendingRequestAncillary[] memory requests)
        public
        view
        returns (RequestState[] memory)
    {
        RequestState[] memory requestStates = new RequestState[](requests.length);
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
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

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function getPriceRequestStatuses(PendingRequest[] memory requests) external view returns (RequestState[] memory) {
        PendingRequestAncillary[] memory requestsAncillary = new PendingRequestAncillary[](requests.length);

        for (uint256 i = 0; i < requests.length; i = unsafe_inc(i)) {
            requestsAncillary[i].identifier = requests[i].identifier;
            requestsAncillary[i].time = requests[i].time;
            requestsAncillary[i].ancillaryData = "";
        }
        return getPriceRequestStatuses(requestsAncillary);
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
    ) public override onlyIfNotMigrated() {
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        address voter = getVoterFromDelegate(msg.sender);
        _updateTrackers(voter);
        uint256 blockTime = getCurrentTime();
        require(hash != bytes32(0), "Invalid provided hash");
        require(voteTiming.computeCurrentPhase(blockTime) == Phase.Commit, "Cannot commit in reveal phase");

        PriceRequest storage priceRequest = _getPriceRequest(identifier, time, ancillaryData);
        require(
            _getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active,
            "Cannot commit inactive request"
        );

        VoteInstance storage voteInstance = priceRequest.voteInstances[currentRoundId];
        voteInstance.voteSubmissions[voter].commit = hash;

        emit VoteCommitted(voter, msg.sender, currentRoundId, identifier, time, ancillaryData);
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function commitVote(
        bytes32 identifier,
        uint256 time,
        bytes32 hash
    ) external override onlyIfNotMigrated() {
        commitVote(identifier, time, "", hash);
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
    ) public override onlyIfNotMigrated() {
        // Note: computing the current round is required to disallow people from revealing an old commit after the round is over.
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        _freezeRoundVariables(currentRoundId);
        VoteInstance storage voteInstance =
            _getPriceRequest(identifier, time, ancillaryData).voteInstances[currentRoundId];
        address voter = getVoterFromDelegate(msg.sender);
        VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[voter];

        // Scoping to get rid of a stack too deep errors for require messages.
        {
            // Can only reveal in the reveal phase.
            require(voteTiming.computeCurrentPhase(getCurrentTime()) == Phase.Reveal);
            // 0 hashes are disallowed in the commit phase, so they indicate a different error.
            // Cannot reveal an uncommitted or previously revealed hash
            require(voteSubmission.commit != bytes32(0), "Invalid hash reveal");

            // Check that the hash that was committed matches to the one that was revealed. Note that if the voter had
            // delegated this means that they must reveal with the same account they had committed with.
            require(
                keccak256(abi.encodePacked(price, salt, msg.sender, time, ancillaryData, currentRoundId, identifier)) ==
                    voteSubmission.commit,
                "Revealed data != commit hash"
            );
        }

        delete voteSubmission.commit; // Small gas refund for clearing up storage.

        voteSubmission.revealHash = keccak256(abi.encode(price)); // Set the voter's submission.
        uint256 activeStake = voterStakes[voter].activeStake;
        voteInstance.resultComputation.addVote(price, activeStake); // Add vote to the results.
        emit VoteRevealed(voter, msg.sender, currentRoundId, identifier, time, price, ancillaryData, activeStake);
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function revealVote(
        bytes32 identifier,
        uint256 time,
        int256 price,
        int256 salt
    ) external override {
        revealVote(identifier, time, price, "", salt);
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

        uint256 roundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        emit EncryptedVote(msg.sender, roundId, identifier, time, ancillaryData, encryptedVote);
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function commitAndEmitEncryptedVote(
        bytes32 identifier,
        uint256 time,
        bytes32 hash,
        bytes memory encryptedVote
    ) public override {
        commitAndEmitEncryptedVote(identifier, time, "", hash, encryptedVote);
    }

    /**
     * @notice Sets the delegate of a voter. This delegate can vote on behalf of the staker. The staker will still own
     * all staked balances, receive rewards and be slashed based on the actions of the delegate. Intended use is using a
     * low-security available wallet for voting while keeping access to staked amounts secure by a more secure wallet.
     * @param delegate the address of the delegate.
     */
    function setDelegate(address delegate) external {
        voterStakes[msg.sender].delegate = delegate;
    }

    /**
     * @notice Sets the delegator of a voter. Acts to accept a delegation. The delegate can only vote for the delegator
     * if the delegator also selected the delegate to do so (two-way relationship needed).
     * @param delegator the address of the delegator.
     */
    function setDelegator(address delegator) external {
        delegateToStaker[msg.sender] = delegator;
    }

    /****************************************
     *        VOTING GETTER FUNCTIONS       *
     ****************************************/

    /**
     * @notice Gets the voter from the delegate.
     * @return address voter that corresponds to the delegate.
     */
    function getVoterFromDelegate(address caller) public view returns (address) {
        if (
            delegateToStaker[caller] != address(0) && // The delegate chose to be a delegate for the staker.
            voterStakes[delegateToStaker[caller]].delegate == caller // The staker chose the delegate.
        ) return delegateToStaker[caller];
        else return caller;
    }

    /**
     * @notice Gets the queries that are being voted on this round.
     * @return pendingRequests array containing identifiers of type PendingRequestAncillary.
     */
    function getPendingRequests() external view override returns (PendingRequestAncillary[] memory) {
        uint256 blockTime = getCurrentTime();
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        // Solidity memory arrays aren't resizable (and reading storage is expensive). Hence this hackery to filter
        // pendingPriceRequests only to those requests that have an Active RequestStatus.
        PendingRequestAncillary[] memory unresolved = new PendingRequestAncillary[](pendingPriceRequests.length);
        uint256 numUnresolved = 0;

        for (uint256 i = 0; i < pendingPriceRequests.length; i = unsafe_inc(i)) {
            PriceRequest storage priceRequest = priceRequests[pendingPriceRequests[i]];
            if (_getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active) {
                unresolved[numUnresolved] = PendingRequestAncillary({
                    identifier: priceRequest.identifier,
                    time: priceRequest.time,
                    ancillaryData: priceRequest.ancillaryData
                });
                numUnresolved++;
            }
        }

        PendingRequestAncillary[] memory pendingRequests = new PendingRequestAncillary[](numUnresolved);
        for (uint256 i = 0; i < numUnresolved; i = unsafe_inc(i)) {
            pendingRequests[i] = unresolved[i];
        }
        return pendingRequests;
    }

    /**
     * @notice Checks if there are current active requests.
     * @return bool true if there are active requests, false otherwise.
     */
    function currentActiveRequests() public view returns (bool) {
        uint256 blockTime = getCurrentTime();
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(blockTime);
        for (uint256 i = 0; i < pendingPriceRequests.length; i = unsafe_inc(i)) {
            if (_getRequestStatus(priceRequests[pendingPriceRequests[i]], currentRoundId) == RequestStatus.Active)
                return true;
        }
        return false;
    }

    /**
     * @notice Returns the current voting phase, as a function of the current time.
     * @return Phase to indicate the current phase. Either { Commit, Reveal, NUM_PHASES }.
     */
    function getVotePhase() public view override returns (Phase) {
        return voteTiming.computeCurrentPhase(getCurrentTime());
    }

    /**
     * @notice Returns the current round ID, as a function of the current time.
     * @return uint256 representing the unique round ID.
     */
    function getCurrentRoundId() external view override returns (uint256) {
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

    function getNumberOfPriceRequests() external view returns (uint256) {
        return priceRequestIds.length;
    }

    function requestSlashingTrackers(uint256 requestIndex) public view returns (SlashingTracker memory) {
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        PriceRequest storage priceRequest = priceRequests[priceRequestIds[requestIndex]];

        if (_getRequestStatus(priceRequest, currentRoundId) != RequestStatus.Resolved)
            return SlashingTracker(0, 0, 0, 0);

        VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];

        uint256 totalVotes = voteInstance.resultComputation.totalVotes;
        uint256 totalCorrectVotes = voteInstance.resultComputation.getTotalCorrectlyVotedTokens();
        uint256 stakedAtRound = rounds[priceRequest.lastVotingRound].cumulativeActiveStakeAtRound;

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
     * @notice Resets the Gat percentage. Note: this change only applies to rounds that have not yet begun.
     * @param newGat sets the next round's Gat.
     */
    function setGat(uint256 newGat) external override onlyOwner {
        require(newGat < votingToken.totalSupply() && newGat > 0);
        gat = newGat;
        emit GatChanged(newGat);
    }

    // Here for abi compatibility. to be removed.
    function setRewardsExpirationTimeout(uint256 NewRewardsExpirationTimeout) external override onlyOwner {}

    /**
     * @notice Changes the slashing library used by this contract.
     * @param _newSlashingLibrary new slashing library address.
     */
    function setSlashingLibrary(address _newSlashingLibrary) external override onlyOwner {
        slashingLibrary = SlashingLibrary(_newSlashingLibrary);
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
     * @notice Updates the voter's trackers for staking and voting in a specific range of priceRequest indexes.
     * @dev this function can be used in place of updateTrackers to process the trackers in batches, hence avoiding
     * potential issues if the number of elements to be processed is big.
     * @param voterAddress address of the voter to update the trackers for.
     * @param indexTo last price request index to update the trackers for.
     */
    function updateTrackersRange(address voterAddress, uint256 indexTo) external {
        require(voterStakes[voterAddress].lastRequestIndexConsidered < indexTo && indexTo <= priceRequestIds.length);

        _updateAccountSlashingTrackers(voterAddress, indexTo);
    }

    // Updates the global and selected wallet's trackers for staking and voting.
    function _updateTrackers(address voterAddress) internal override {
        _updateAccountSlashingTrackers(voterAddress, priceRequestIds.length);
        super._updateTrackers(voterAddress);
    }

    function getStartingIndexForStaker() internal view override returns (uint64) {
        return SafeCast.toUint64(priceRequestIds.length - (inActiveReveal() ? 0 : pendingPriceRequests.length));
    }

    // Checks if we are in an active voting reveal phase (currently revealing votes).
    function inActiveReveal() internal view override returns (bool) {
        return (currentActiveRequests() && getVotePhase() == Phase.Reveal);
    }

    // Updates the slashing trackers of a given account based on previous voting activity.
    function _updateAccountSlashingTrackers(address voterAddress, uint256 indexTo) internal {
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        VoterStake storage voterStake = voterStakes[voterAddress];
        // Note the method below can hit a gas limit of there are a LOT of requests from the last time this was run.
        // A future version of this should bound how many requests to look at per call to avoid gas limit issues.

        // Traverse all requests from the last considered request. For each request see if the voter voted correctly or
        // not. Based on the outcome, attribute the associated slash to the voter.
        int256 slash = 0;
        for (
            uint64 requestIndex = voterStake.lastRequestIndexConsidered;
            requestIndex < indexTo;
            requestIndex = unsafe_inc_64(requestIndex)
        ) {
            if (skippedRequestIndexes[requestIndex] != 0) {
                requestIndex = skippedRequestIndexes[requestIndex];
                continue;
            }

            if (requestIndex > indexTo - 1) break; // This happens if the last element was a rolled vote.
            PriceRequest storage priceRequest = priceRequests[priceRequestIds[requestIndex]];
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];

            // If the request status is not resolved then: a) Either we are still in the current voting round, in which
            // case break the loop and stop iterating (all subsequent requests will be in the same state by default) or
            // b) we have gotten to a rolled vote in which case we need to update some internal trackers for this vote
            // and set this within the skippedRequestIndexes mapping so the next time we hit this it is skipped.
            if (!_priceRequestResolved(priceRequest, voteInstance, currentRoundId)) {
                // If the request is not resolved and the lastVotingRound less than the current round then the vote
                // must have been rolled. In this case, update the internal trackers for this vote.

                if (priceRequest.lastVotingRound < currentRoundId) {
                    priceRequest.lastVotingRound = SafeCast.toUint32(currentRoundId);
                    skippedRequestIndexes[requestIndex] = requestIndex;
                    priceRequest.priceRequestIndex = SafeCast.toUint64(priceRequestIds.length);
                    priceRequestIds.push(priceRequestIds[requestIndex]);
                    continue;
                }
                // Else, we are simply evaluating a request that is still actively being voted on. In this case, break as
                // all subsequent requests within the array must be in the same state and can't have any slashing applied.
                break;
            }

            uint256 totalCorrectVotes = voteInstance.resultComputation.getTotalCorrectlyVotedTokens();

            (uint256 wrongVoteSlashPerToken, uint256 noVoteSlashPerToken) =
                slashingLibrary.calcSlashing(
                    rounds[priceRequest.lastVotingRound].cumulativeActiveStakeAtRound,
                    voteInstance.resultComputation.totalVotes,
                    totalCorrectVotes,
                    priceRequest.isGovernance
                );

            // The voter did not reveal or did not commit. Slash at noVote rate.
            if (voteInstance.voteSubmissions[voterAddress].revealHash == 0)
                slash -= int256((voterStake.activeStake * noVoteSlashPerToken) / 1e18);

                // The voter did not vote with the majority. Slash at wrongVote rate.
            else if (
                !voteInstance.resultComputation.wasVoteCorrect(voteInstance.voteSubmissions[voterAddress].revealHash)
            )
                slash -= int256((voterStake.activeStake * wrongVoteSlashPerToken) / 1e18);

                // The voter voted correctly. Receive a pro-rate share of the other voters slashed amounts as a reward.
            else {
                // Compute the total amount slashed over all stakers. This is the sum of the total slashed for not voting
                // and the total slashed for voting incorrectly. Use this to work out the stakers prorate share.
                uint256 totalSlashed =
                    ((noVoteSlashPerToken *
                        (rounds[priceRequest.lastVotingRound].cumulativeActiveStakeAtRound -
                            voteInstance.resultComputation.totalVotes)) +
                        ((wrongVoteSlashPerToken * (voteInstance.resultComputation.totalVotes - totalCorrectVotes)))) /
                        1e18;
                slash += int256(((voterStake.activeStake * totalSlashed)) / totalCorrectVotes);
            }

            // If this is not the last price request to apply and the next request in the batch is from a subsequent
            // round then apply the slashing now. Else, do nothing and apply the slashing after the loop concludes.
            // This acts to apply slashing within a round as independent actions: multiple votes within the same round
            // should not impact each other but subsequent rounds should impact each other. We need to consider the
            // skippedRequestIndexes mapping when finding the next index as the next request may have been deleted or rolled.
            uint256 nextRequestIndex =
                skippedRequestIndexes[requestIndex + 1] != 0
                    ? skippedRequestIndexes[requestIndex + 1] + 1
                    : requestIndex + 1;
            if (
                slash != 0 &&
                indexTo > nextRequestIndex &&
                priceRequest.lastVotingRound != priceRequests[priceRequestIds[nextRequestIndex]].lastVotingRound
            ) {
                applySlashToVoter(slash, voterStake, voterAddress);
                slash = 0;
            }
            voterStake.lastRequestIndexConsidered = requestIndex + 1;
        }

        if (slash != 0) applySlashToVoter(slash, voterStake, voterAddress);
    }

    // Applies a given slash to a given voter's stake.
    function applySlashToVoter(
        int256 slash,
        VoterStake storage voterStake,
        address voterAddress
    ) internal {
        if (slash + int256(voterStake.activeStake) > 0)
            voterStake.activeStake = uint256(int256(voterStake.activeStake) + slash);
        else voterStake.activeStake = 0;
        emit VoterSlashed(voterAddress, slash, voterStake.activeStake);
    }

    /****************************************
     *       SPAM DELETION FUNCTIONS        *
     ****************************************/

    /**
     * @notice Declare a specific price requests range to be spam and request its deletion.
     * @dev note that this method should almost never be used. The bond to call this should be set to
     * a very large number (say 10k UMA) as it could be abused if set too low. Function constructs a price
     * request that, if passed, enables pending requests to be disregarded by the contract.
     * @param spamRequestIndices list of request indices to be declared as spam. Each element is a
     * pair of uint256s representing the start and end of the range.
     */
    function signalRequestsAsSpamForDeletion(uint256[2][] calldata spamRequestIndices) external {
        votingToken.transferFrom(msg.sender, address(this), spamDeletionProposalBond);
        uint256 currentTime = getCurrentTime();
        uint256 runningValidationIndex;
        uint256 spamRequestIndicesLength = spamRequestIndices.length;
        for (uint256 i = 0; i < spamRequestIndicesLength; i = unsafe_inc(i)) {
            uint256[2] memory spamRequestIndex = spamRequestIndices[i];

            // Check request end index is greater than start index, endIndex is less than the total number of requests,
            // and validate index continuity (each sequential element within the spamRequestIndices array is sequential
            // and increasing in size).
            require(
                spamRequestIndex[0] <= spamRequestIndex[1] &&
                    spamRequestIndex[1] < priceRequestIds.length &&
                    spamRequestIndex[1] > runningValidationIndex
            );

            runningValidationIndex = spamRequestIndex[1];
        }

        spamDeletionProposals.push(
            SpamDeletionRequest({
                spamRequestIndices: spamRequestIndices,
                requestTime: currentTime,
                executed: false,
                proposer: msg.sender,
                bond: spamDeletionProposalBond
            })
        );

        uint256 proposalId = spamDeletionProposals.length - 1;

        // Note that for proposalId>= 10^11 the generated identifier will no longer be unique but the manner
        // in which the priceRequest id is encoded in _encodePriceRequest guarantees its uniqueness.
        bytes32 identifier = SpamGuardIdentifierLib._constructIdentifier(SafeCast.toUint32(proposalId));

        _requestPrice(identifier, currentTime, "", true);

        emit SignaledRequestsAsSpamForDeletion(proposalId, msg.sender, spamRequestIndices);
    }

    /**
     * @notice Execute the spam deletion proposal if it has been approved by voting.
     * @param proposalId spam deletion proposal id.
     */
    function executeSpamDeletion(uint256 proposalId) external {
        require(spamDeletionProposals[proposalId].executed == false);
        spamDeletionProposals[proposalId].executed = true;

        bytes32 identifier = SpamGuardIdentifierLib._constructIdentifier(SafeCast.toUint32(proposalId));

        (bool hasPrice, int256 resolutionPrice, ) =
            _getPriceOrError(identifier, spamDeletionProposals[proposalId].requestTime, "");
        require(hasPrice);

        // If the price is non zero then the spam deletion request was voted up to delete the requests. Execute delete.
        if (resolutionPrice != 0) {
            // Delete the price requests associated with the spam.
            for (uint256 i = 0; i < spamDeletionProposals[proposalId].spamRequestIndices.length; i = unsafe_inc(i)) {
                uint64 startIndex = uint64(spamDeletionProposals[proposalId].spamRequestIndices[uint256(i)][0]);
                uint64 endIndex = uint64(spamDeletionProposals[proposalId].spamRequestIndices[uint256(i)][1]);
                for (uint256 j = startIndex; j <= endIndex; j++) {
                    bytes32 requestId = priceRequestIds[j];
                    // Remove from pendingPriceRequests.
                    _removeRequestFromPendingPriceRequests(priceRequests[requestId].pendingRequestIndex);

                    // Remove the request from the priceRequests mapping.
                    delete priceRequests[requestId];
                }

                // Set the deletion request jump mapping. This enables the for loops that iterate over requests to skip
                // the deleted requests via a "jump" over the removed elements from the array.
                skippedRequestIndexes[startIndex] = endIndex;
            }

            // Return the spamDeletionProposalBond.
            votingToken.transfer(spamDeletionProposals[proposalId].proposer, spamDeletionProposals[proposalId].bond);
            emit ExecutedSpamDeletion(proposalId, true);
        }
        // Else, the spam deletion request was voted down. In this case we send the spamDeletionProposalBond to the store.
        else {
            votingToken.transfer(finder.getImplementationAddress(OracleInterfaces.Store), spamDeletionProposalBond);
            emit ExecutedSpamDeletion(proposalId, false);
        }
    }

    /**
     * @notice Set the spam deletion proposal bond.
     * @param _spamDeletionProposalBond new spam deletion proposal bond.
     */
    function setSpamDeletionProposalBond(uint256 _spamDeletionProposalBond) public onlyOwner() {
        spamDeletionProposalBond = _spamDeletionProposalBond;
        emit SpamDeletionProposalBondChanged(_spamDeletionProposalBond);
    }

    /**
     * @notice Get the spam deletion request by the proposal id.
     * @param spamDeletionRequestId spam deletion request id.
     * @return SpamDeletionRequest the spam deletion request.
     */
    function getSpamDeletionRequest(uint256 spamDeletionRequestId) external view returns (SpamDeletionRequest memory) {
        return spamDeletionProposals[spamDeletionRequestId];
    }

    /****************************************
     *    PRIVATE AND INTERNAL FUNCTIONS    *
     ****************************************/

    function _removeRequestFromPendingPriceRequests(uint64 pendingRequestIndex) internal {
        uint256 lastIndex = pendingPriceRequests.length - 1;
        PriceRequest storage lastPriceRequest = priceRequests[pendingPriceRequests[lastIndex]];
        lastPriceRequest.pendingRequestIndex = pendingRequestIndex;
        pendingPriceRequests[pendingRequestIndex] = pendingPriceRequests[lastIndex];
        pendingPriceRequests.pop();
    }

    // Returns the price for a given identifer. Three params are returns: bool if there was an error, int to represent
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
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());

        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);
        if (requestStatus == RequestStatus.Active) return (false, 0, "Current voting round not ended");
        else if (requestStatus == RequestStatus.Resolved) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (, int256 resolvedPrice) =
                voteInstance.resultComputation.getResolvedPrice(_computeGat(priceRequest.lastVotingRound));
            return (true, resolvedPrice, "");
        } else if (requestStatus == RequestStatus.Future) return (false, 0, "Price is still to be voted on");
        else return (false, 0, "Price was never requested");
    }

    function _getPriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) private view returns (PriceRequest storage) {
        return priceRequests[_encodePriceRequest(identifier, time, ancillaryData)];
    }

    function _encodePriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(identifier, time, ancillaryData));
    }

    function _freezeRoundVariables(uint256 roundId) private {
        // Only freeze the round if this is the first request in the round.
        if (rounds[roundId].gat == 0) {
            // Set the round gat percentage to the current global gat rate.
            rounds[roundId].gat = gat;

            // Store the cumulativeActiveStake at this roundId to work out slashing and voting trackers.
            rounds[roundId].cumulativeActiveStakeAtRound = cumulativeActiveStake;
        }
    }

    function _priceRequestResolved(
        PriceRequest storage priceRequest,
        VoteInstance storage voteInstance,
        uint256 currentRoundId
    ) private returns (bool) {
        // We are currently either in the voting round for the request or voting is yet to begin.
        if (currentRoundId <= priceRequest.lastVotingRound) return false;

        // If the request has been previously resolved, return true.
        if (priceRequest.pendingRequestIndex == UINT64_MAX) return true;

        // Else, check if the price can be resolved.
        (bool isResolvable, int256 resolvedPrice) =
            voteInstance.resultComputation.getResolvedPrice(_computeGat(priceRequest.lastVotingRound));

        // If it's not resolvable return false.
        if (!isResolvable) return false;

        // Else, the request is resolvable. Remove the element from the pending requests and update pendingRequestIndex
        // within the price request struct to make the next entry into this method a no-op for this request.
        _removeRequestFromPendingPriceRequests(priceRequest.pendingRequestIndex);

        priceRequest.pendingRequestIndex = UINT64_MAX;
        emit PriceResolved(
            priceRequest.lastVotingRound,
            priceRequest.identifier,
            priceRequest.time,
            priceRequest.priceRequestIndex,
            resolvedPrice,
            priceRequest.ancillaryData
        );
        return true;
    }

    function _computeGat(uint256 roundId) internal view returns (uint256) {
        // Return the GAT.
        return rounds[roundId].gat;
    }

    function _getRequestStatus(PriceRequest storage priceRequest, uint256 currentRoundId)
        private
        view
        returns (RequestStatus)
    {
        if (priceRequest.lastVotingRound == 0) return RequestStatus.NotRequested;
        else if (priceRequest.lastVotingRound < currentRoundId) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (bool isResolved, ) =
                voteInstance.resultComputation.getResolvedPrice(_computeGat(priceRequest.lastVotingRound));

            return isResolved ? RequestStatus.Resolved : RequestStatus.Active;
        } else if (priceRequest.lastVotingRound == currentRoundId) return RequestStatus.Active;
        // Means than priceRequest.lastVotingRound > currentRoundId
        else return RequestStatus.Future;
    }

    function unsafe_inc(uint256 x) internal pure returns (uint256) {
        unchecked { return x + 1; }
    }

    function unsafe_inc_64(uint64 x) internal pure returns (uint64) {
        unchecked { return x + 1; }
    }

    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _requireNotMigrated() private view {
        require(migratedAddress == address(0));
    }

    function _requireRegisteredContract() private view {
        Registry registry = Registry(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(
            registry.isContractRegistered(msg.sender) || msg.sender == migratedAddress,
            "Caller must be registered"
        );
    }
}
