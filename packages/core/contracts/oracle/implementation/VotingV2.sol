// TODO: this whole /oracle/implementation directory should be restructured to separate the DVM and the OO.

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/FixedPoint.sol"; // TODO: remove this from this contract.

import "../interfaces/FinderInterface.sol";
import "../interfaces/OracleInterface.sol";
import "../interfaces/OracleAncillaryInterface.sol";
import "../interfaces/OracleGovernanceInterface.sol";
import "../interfaces/VotingV2Interface.sol";
import "../interfaces/VotingAncillaryInterface.sol"; // TODO: remove this and simplify down to one v2 interface.
import "../interfaces/IdentifierWhitelistInterface.sol";
import "./Registry.sol";
import "./ResultComputation.sol";
import "./VoteTimingV2.sol";
import "./Staker.sol";
import "./Constants.sol";
import "./SlashingLibrary.sol";
import "./SpamGuardIdentifierLib.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Voting system for Oracle.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting scheme.
 */
// TODO: right now there are multiple interfaces (OracleInterface & OracleAncillaryInterface). We should only have one
// which should be done by removing the overloaded interfaces.

contract VotingV2 is
    Staker,
    OracleAncillaryInterface, // Interface to support ancillary data with price requests.
    OracleGovernanceInterface, // Interface to support governance requests.
    VotingV2Interface,
    VotingAncillaryInterface // Interface to support ancillary data with voting rounds.
{
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;
    using VoteTimingV2 for VoteTimingV2.Data;
    using ResultComputation for ResultComputation.Data;

    /****************************************
     *        VOTING DATA STRUCTURES        *
     ****************************************/

    // Identifies a unique price request for which the Oracle will always return the same value.
    // Tracks ongoing votes as well as the result of the vote.

    struct PriceRequest {
        bytes32 identifier;
        uint256 time;
        // A map containing all votes for this price in various rounds.
        mapping(uint256 => VoteInstance) voteInstances;
        // If in the past, this was the voting round where this price was resolved. If current or the upcoming round,
        // this is the voting round where this price will be voted on, but not necessarily resolved.
        uint256 lastVotingRound;
        // The index in the `pendingPriceRequests` that references this PriceRequest. A value of UINT_MAX means that
        // this PriceRequest is resolved and has been cleaned up from `pendingPriceRequests`.
        uint256 index;
        bool isGovernance;
        bytes ancillaryData;
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

    struct Round {
        FixedPoint.Unsigned gatPercentage; // Gat rate set for this round.
        uint256 cumulativeStakedAtRound; // Total staked tokens at the start of the round.
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
    mapping(bytes32 => PriceRequest) internal priceRequests;

    struct Request {
        bytes32 requestId;
        uint256 roundId;
    }

    // TODO: consider replacing this structure with a linked list.
    Request[] public priceRequestIds;

    mapping(uint256 => uint256) public deletedRequestJumpMapping;

    // Price request ids for price requests that haven't yet been marked as resolved.
    // These requests may be for future rounds.
    bytes32[] internal pendingPriceRequests;

    VoteTimingV2.Data public voteTiming;

    // Percentage of the total token supply that must be used in a vote to
    // create a valid price resolution. 1 == 100%.
    FixedPoint.Unsigned public gatPercentage;

    // Reference to the Finder.
    FinderInterface private immutable finder;

    // Reference to Slashing Library.
    SlashingLibrary public slashingLibrary;

    // If non-zero, this contract has been migrated to this address. All voters and
    // financial contracts should query the new address only.
    address public migratedAddress;

    // Max value of an unsigned integer.
    uint256 private constant UINT_MAX = ~uint256(0);

    // Max length in bytes of ancillary data that can be appended to a price request.
    // As of December 2020, the current Ethereum gas limit is 12.5 million. This requestPrice function's gas primarily
    // comes from computing a Keccak-256 hash in _encodePriceRequest and writing a new PriceRequest to
    // storage. We have empirically determined an ancillary data limit of 8192 bytes that keeps this function
    // well within the gas limit at ~8 million gas. To learn more about the gas limit and EVM opcode costs go here:
    // - https://etherscan.io/chart/gaslimit
    // - https://github.com/djrtwo/evm-opcode-gas-costs
    uint256 public constant ancillaryBytesLimit = 8192;

    /****************************************
     *          SLASHING TRACKERS           *
     ****************************************/

    uint256 public lastRequestIndexConsidered;

    struct SlashingTracker {
        uint256 wrongVoteSlashPerToken;
        uint256 noVoteSlashPerToken;
        uint256 totalSlashed;
        uint256 totalCorrectVotes;
    }

    mapping(uint256 => SlashingTracker) public requestSlashingTrackers;

    /****************************************
     *        SPAM DELETION TRACKERS        *
     ****************************************/

    uint256 spamDeletionProposalBond;

    struct SpamDeletionRequest {
        uint256[2][] spamRequestIndices;
        uint256 requestTime;
        bool executed;
        address proposer;
    }

    // Maps round numbers to the spam deletion request.
    SpamDeletionRequest[] internal spamDeletionProposals;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event VoteCommitted(
        address indexed voter,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData
    );

    event EncryptedVote(
        address indexed voter,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        bytes encryptedVote
    );

    event VoteRevealed(
        address indexed voter,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        int256 price,
        bytes ancillaryData,
        uint256 numTokens
    );

    event RewardsRetrieved(
        address indexed voter,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        uint256 numTokens
    );

    event PriceRequestAdded(uint256 indexed roundId, bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    event PriceResolved(
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        int256 price,
        bytes ancillaryData
    );

    // /**
    //  * @notice Construct the Voting contract.
    //  * @param _phaseLength length of the commit and reveal phases in seconds.
    //  * @param _gatPercentage of the total token supply that must be used in a vote to create a valid price resolution.
    //  * @param _votingToken address of the UMA token contract used to commit votes.
    //  * @param _finder keeps track of all contracts within the system based on their interfaceName.
    //  * @param _timerAddress Contract that stores the current time in a testing environment.
    //  * Must be set to 0x0 for production environments that use live time.
    //  */
    constructor(
        uint256 _emissionRate,
        uint256 _unstakeCoolDown,
        uint256 _phaseLength,
        uint256 _minRollToNextRoundLength,
        FixedPoint.Unsigned memory _gatPercentage,
        address _votingToken,
        address _finder,
        address _timerAddress,
        address _slashingLibrary
    ) Staker(_emissionRate, _unstakeCoolDown, _votingToken, _timerAddress) {
        voteTiming.init(_phaseLength, _minRollToNextRoundLength);
        require(_gatPercentage.isLessThanOrEqual(1), "GAT percentage must be <= 100%");
        gatPercentage = _gatPercentage;
        finder = FinderInterface(_finder);
        slashingLibrary = SlashingLibrary(_slashingLibrary);
        setSpamDeletionProposalBond(10000e18); // Set the spam deletion proposal bond to 10,000 UMA. // TODO: make constructor param.
    }

    /***************************************
                    MODIFIERS
    ****************************************/

    modifier onlyRegisteredContract() {
        if (migratedAddress != address(0)) {
            require(msg.sender == migratedAddress, "Caller must be migrated address");
        } else {
            Registry registry = Registry(finder.getImplementationAddress(OracleInterfaces.Registry));
            require(registry.isContractRegistered(msg.sender), "Called must be registered");
        }
        _;
    }

    modifier onlyIfNotMigrated() {
        require(migratedAddress == address(0), "Only call this if not migrated");
        _;
    }

    /****************************************
     *          STAKING FUNCTIONS           *
     ****************************************/

    function updateTrackers(address voterAddress) public {
        _updateTrackers(voterAddress);
    }

    function _updateTrackers(address voterAddress) internal override {
        _updateCumulativeSlashingTrackers();
        _updateAccountSlashingTrackers(voterAddress);
        _updateReward(voterAddress);
    }

    function _updateAccountSlashingTrackers(address voterAddress) internal {
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        VoterStake storage voterStake = voterStakes[voterAddress];
        // Note the method below can hit a gas limit of there are a LOT of requests from the last time this was run.
        // A future version of this should bound how many requests to look at per call to avoid gas limit issues.
        int256 slash = 0;

        // Traverse all requests from the last considered request. For each request see if the voter voted correctly or
        // not. Based on the outcome, attribute the associated slash to the voter.
        uint256 priceRequestIdsLength = priceRequestIds.length;
        for (uint256 i = voterStake.lastRequestIndexConsidered; i < priceRequestIdsLength; i = unsafe_inc(i)) {
            if (deletedRequestJumpMapping[i] != 0) i = deletedRequestJumpMapping[i] + 1;
            PriceRequest storage priceRequest = priceRequests[priceRequestIds[i].requestId];
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            uint256 roundId = priceRequestIds[i].roundId;

            // Cant slash this or any subsequent requests if the request is not settled. TODO: this has implications for
            // rolled votes and should be considered closely.
            if (_getRequestStatus(priceRequest, currentRoundId) != RequestStatus.Resolved) break;

            bytes32 revealHash = voteInstance.voteSubmissions[voterAddress].revealHash;
            // The voter did not reveal or did not commit. Slash at noVote rate.
            if (revealHash == 0)
                slash -= int256((voterStake.cumulativeStaked * requestSlashingTrackers[i].noVoteSlashPerToken) / 1e18);

                // The voter did not vote with the majority. Slash at wrongVote rate.
            else if (!voteInstance.resultComputation.wasVoteCorrect(revealHash))
                slash -= int256(
                    (voterStake.cumulativeStaked * requestSlashingTrackers[i].wrongVoteSlashPerToken) / 1e18
                );

                // The voter voted correctly. Receive a pro-rate share of the other voters slashed amounts as a reward.
            else
                slash += int256(
                    (((voterStake.cumulativeStaked * requestSlashingTrackers[i].totalSlashed)) /
                        requestSlashingTrackers[i].totalCorrectVotes)
                );

            // If this is not the last price request to apply and the next request in the batch is from a subsequent
            // round then apply the slashing now. Else, do nothing and apply the slashing after the loop concludes.
            // This acts to apply slashing within a round as independent actions: multiple votes within the same round
            // should not impact each other but subsequent rounds should impact each other.
            if (priceRequestIdsLength - i > 1 && roundId != priceRequestIds[i + 1].roundId) {
                applySlashToVoter(slash, voterAddress);
                slash = 0;
            }
            voterStake.lastRequestIndexConsidered = i + 1;
        }

        if (slash != 0) applySlashToVoter(slash, voterAddress);
    }

    function applySlashToVoter(int256 slash, address voterAddress) internal {
        VoterStake storage voterStake = voterStakes[voterAddress];
        if (slash + int256(voterStake.cumulativeStaked) > 0)
            voterStake.cumulativeStaked = uint256(int256(voterStake.cumulativeStaked) + slash);
        else voterStake.cumulativeStaked = 0;
    }

    function _updateCumulativeSlashingTrackers() internal {
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        // Note the method below can hit a gas limit of there are a LOT of requests from the last time this was run.
        // A future version of this should bound how many requests to look at per call to avoid gas limit issues.

        // Traverse all price requests from the last time this method was called and for each request compute and store
        // the associated slashing rates as a function of the total staked, total votes and total correct votes. Note
        // that this method in almost all cases will only need to traverse one request as slashing trackers are updated
        // on every commit and so it is not too computationally inefficient.
        uint256 priceRequestIdsLength = priceRequestIds.length;
        for (uint256 i = lastRequestIndexConsidered; i < priceRequestIdsLength; i = unsafe_inc(i)) {
            if (deletedRequestJumpMapping[i] != 0) i = deletedRequestJumpMapping[i] + 1;
            Request memory request = priceRequestIds[i];
            PriceRequest storage priceRequest = priceRequests[request.requestId];
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];

            // Cant slash this or any subsequent requests if the request is not settled. TODO: this has implications for
            // rolled votes and should be considered closely.
            if (_getRequestStatus(priceRequest, currentRoundId) != RequestStatus.Resolved) break;
            uint256 stakedAtRound = rounds[request.roundId].cumulativeStakedAtRound;
            uint256 totalVotes = voteInstance.resultComputation.totalVotes.rawValue;
            uint256 totalCorrectVotes = voteInstance.resultComputation.getTotalCorrectlyVotedTokens().rawValue;
            uint256 wrongVoteSlashPerToken =
                priceRequest.isGovernance
                    ? slashingLibrary.calcWrongVoteSlashPerTokenGovernance(stakedAtRound, totalVotes, totalCorrectVotes)
                    : slashingLibrary.calcWrongVoteSlashPerToken(stakedAtRound, totalVotes, totalCorrectVotes);
            uint256 noVoteSlashPerToken =
                slashingLibrary.calcNoVoteSlashPerToken(stakedAtRound, totalVotes, totalCorrectVotes);

            uint256 totalSlashed =
                ((noVoteSlashPerToken * (stakedAtRound - totalVotes)) / 1e18) +
                    ((wrongVoteSlashPerToken * (totalVotes - totalCorrectVotes)) / 1e18);

            requestSlashingTrackers[i] = SlashingTracker(
                wrongVoteSlashPerToken,
                noVoteSlashPerToken,
                totalSlashed,
                totalCorrectVotes
            );

            lastRequestIndexConsidered = i + 1;
        }
    }

    /****************************************
     *       SPAM DELETION FUNCTIONS        *
     ****************************************/

    function signalRequestsAsSpamForDeletion(uint256[2][] calldata spamRequestIndices) public {
        votingToken.transferFrom(msg.sender, address(this), spamDeletionProposalBond);
        uint256 currentTime = getCurrentTime();
        uint256 runningValidationIndex;
        uint256 spamRequestIndicesLength = spamRequestIndices.length;
        for (uint256 i = 0; i < spamRequestIndicesLength; i = unsafe_inc(i)) {
            uint256[2] memory spamRequestIndex = spamRequestIndices[i];
            // Check request end index is greater than start index.
            require(spamRequestIndex[0] <= spamRequestIndex[1], "Bad start index");

            // check the endIndex is less than the total number of requests.
            require(spamRequestIndex[1] < priceRequestIds.length, "Bad end index");

            // Validate index continuity. This checks that each sequential element within the spamRequestIndices
            // array is sequently and increasing in size.
            require(spamRequestIndex[1] > runningValidationIndex, "Bad index continuity");
            runningValidationIndex = spamRequestIndex[1];
        }
        // todo: consider if we want to check if the most recent price request has been settled?

        spamDeletionProposals.push(SpamDeletionRequest(spamRequestIndices, currentTime, false, msg.sender));
        uint256 proposalId = spamDeletionProposals.length - 1;

        bytes32 identifier = SpamGuardIdentifierLib._constructIdentifier(proposalId);

        _requestPrice(identifier, currentTime, "", true);
    }

    function executeSpamDeletion(uint256 proposalId) public {
        require(spamDeletionProposals[proposalId].executed == false, "Already executed");
        spamDeletionProposals[proposalId].executed = true;
        bytes32 identifier = SpamGuardIdentifierLib._constructIdentifier(proposalId);

        (bool hasPrice, int256 resolutionPrice, ) =
            _getPriceOrError(identifier, spamDeletionProposals[proposalId].requestTime, "");
        require(hasPrice, "Price not yet resolved");

        // If the price is 1e18 then the spam deletion request was correctly voted on to delete the requests.
        if (resolutionPrice == 1e18) {
            // Delete the price requests associated with the spam.
            for (uint256 i = 0; i < spamDeletionProposals[proposalId].spamRequestIndices.length; i = unsafe_inc(i)) {
                uint256 startIndex = spamDeletionProposals[proposalId].spamRequestIndices[uint256(i)][0];
                uint256 endIndex = spamDeletionProposals[proposalId].spamRequestIndices[uint256(i)][1];
                for (uint256 j = startIndex; j <= endIndex; j++) {
                    bytes32 requestId = priceRequestIds[j].requestId;
                    // Remove from pendingPriceRequests.
                    uint256 lastIndex = pendingPriceRequests.length - 1;
                    PriceRequest storage lastPriceRequest = priceRequests[pendingPriceRequests[lastIndex]];
                    lastPriceRequest.index = priceRequests[requestId].index;
                    pendingPriceRequests[priceRequests[requestId].index] = pendingPriceRequests[lastIndex];
                    pendingPriceRequests.pop();

                    // Remove the request from the priceRequests mapping.
                    delete priceRequests[requestId];
                }

                // Set the deletion request jump mapping. This enables the for loops that iterate over requests to skip
                // the deleted requests via a "jump" over the removed elements from the array.
                deletedRequestJumpMapping[startIndex] = endIndex;
            }

            // Return the spamDeletionProposalBond.
            votingToken.transfer(spamDeletionProposals[proposalId].proposer, spamDeletionProposalBond);
        }
        // Else, the spam deletion request was voted down. In this case we send the spamDeletionProposalBond to the store.
        else {
            votingToken.transfer(finder.getImplementationAddress(OracleInterfaces.Store), spamDeletionProposalBond);
        }
    }

    function setSpamDeletionProposalBond(uint256 _spamDeletionProposalBond) public onlyOwner() {
        spamDeletionProposalBond = _spamDeletionProposalBond;
    }

    function getSpamDeletionRequest(uint256 spamDeletionRequestId) public view returns (SpamDeletionRequest memory) {
        return spamDeletionProposals[spamDeletionRequestId];
    }

    /****************************************
     *  PRICE REQUEST AND ACCESS FUNCTIONS  *
     ****************************************/

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given `identifier`, `time` pair.
     * @dev Time must be in the past and the identifier must be supported. The length of the ancillary data
     * is limited such that this method abides by the EVM transaction gas limit.
     * @param identifier uniquely identifies the price requested. eg BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp for the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override onlyRegisteredContract() {
        _requestPrice(identifier, time, ancillaryData, false);
    }

    /**
     * @notice Enqueues a governance action request (if a request isn't already present) for the given `identifier`, `time` pair.
     * @dev Time must be in the past and the identifier must be supported. The length of the ancillary data
     * is limited such that this method abides by the EVM transaction gas limit.
     * @param identifier uniquely identifies the price requested. eg BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp for the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     */
    function requestGovernanceAction(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override onlyOwner() {
        _requestPrice(identifier, time, ancillaryData, true);
    }

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given `identifier`, `time` pair.
     * @dev Time must be in the past and the identifier must be supported. The length of the ancillary data
     * is limited such that this method abides by the EVM transaction gas limit.
     * @param identifier uniquely identifies the price requested. eg BTC/USD (encoded as bytes32) could be requested.
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
        require(ancillaryData.length <= ancillaryBytesLimit, "Invalid ancillary data");

        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage priceRequest = priceRequests[priceRequestId];
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);

        if (requestStatus == RequestStatus.NotRequested) {
            // Price has never been requested.
            // If the price request is a governance action then always place it in the following round. If the price
            // request is a normal request then either place it in the next round or the following round based off
            // the minRolllToNextRoundLength.
            uint256 roundIdToVoteOnPriceRequest =
                isGovernance ? currentRoundId + 1 : voteTiming.computeRoundToVoteOnPriceRequest(blockTime);

            priceRequestIds.push(Request(priceRequestId, roundIdToVoteOnPriceRequest));

            PriceRequest storage newPriceRequest = priceRequests[priceRequestId];
            newPriceRequest.identifier = identifier;
            newPriceRequest.time = time;
            newPriceRequest.lastVotingRound = roundIdToVoteOnPriceRequest;
            newPriceRequest.index = pendingPriceRequests.length;
            newPriceRequest.ancillaryData = ancillaryData;
            newPriceRequest.isGovernance = isGovernance;

            pendingPriceRequests.push(priceRequestId);
            emit PriceRequestAdded(roundIdToVoteOnPriceRequest, identifier, time, ancillaryData);
        }
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function requestPrice(bytes32 identifier, uint256 time) public override {
        requestPrice(identifier, time, "");
    }

    /**
     * @notice Whether the price for `identifier` and `time` is available.
     * @dev Time must be in the past and the identifier must be supported.
     * @param identifier uniquely identifies the price requested. eg BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of for the price request.
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

    // TODO: remove all overriden functions that miss ancillary data. DVM2.0 should only accept ancillary data requests.
    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function hasPrice(bytes32 identifier, uint256 time) public view override returns (bool) {
        return hasPrice(identifier, time, "");
    }

    /**
     * @notice Gets the price for `identifier` and `time` if it has already been requested and resolved.
     * @dev If the price is not available, the method reverts.
     * @param identifier uniquely identifies the price requested. eg BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of for the price request.
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
    function getPrice(bytes32 identifier, uint256 time) public view override returns (int256) {
        return getPrice(identifier, time, "");
    }

    /**
     * @notice Gets the status of a list of price requests, identified by their identifier and time.
     * @dev If the status for a particular request is NotRequested, the lastVotingRound will always be 0.
     * @param requests array of type PendingRequest which includes an identifier and timestamp for each request.
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
            if (status == RequestStatus.Active) {
                requestStates[i].lastVotingRound = currentRoundId;
            } else {
                requestStates[i].lastVotingRound = priceRequest.lastVotingRound;
            }
            requestStates[i].status = status;
        }
        return requestStates;
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function getPriceRequestStatuses(PendingRequest[] memory requests) public view returns (RequestState[] memory) {
        PendingRequestAncillary[] memory requestsAncillary = new PendingRequestAncillary[](requests.length);

        for (uint256 i = 0; i < requests.length; i = unsafe_inc(i)) {
            requestsAncillary[i].identifier = requests[i].identifier;
            requestsAncillary[i].time = requests[i].time;
            requestsAncillary[i].ancillaryData = "";
        }
        return getPriceRequestStatuses(requestsAncillary);
    }

    /****************************************
     *            VOTING FUNCTIONS          *
     ****************************************/

    /**
     * @notice Commit a vote for a price request for `identifier` at `time`.
     * @dev `identifier`, `time` must correspond to a price request that's currently in the commit phase.
     * Commits can be changed.
     * @dev Since transaction data is public, the salt will be revealed with the vote. While this is the system’s
     * expected behavior, voters should never reuse salts. If someone else is able to guess the voted price and knows
     * that a salt will be reused, then they can determine the vote pre-reveal.
     * @param identifier uniquely identifies the committed vote. EG BTC/USD price pair.
     * @param time unix timestamp of the price being voted on.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param hash keccak256 hash of the `price`, `salt`, voter `address`, `time`, current `roundId`, and `identifier`.
     */
    function commitVote(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bytes32 hash
    ) public override onlyIfNotMigrated() {
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        _freezeRoundVariables(currentRoundId);
        _updateTrackers(msg.sender);
        // At this point, the computed and last updated round ID should be equal.
        uint256 blockTime = getCurrentTime();
        require(hash != bytes32(0), "Invalid provided hash");
        // Current time is required for all vote timing queries.
        require(
            voteTiming.computeCurrentPhase(blockTime) == VotingAncillaryInterface.Phase.Commit,
            "Cannot commit in reveal phase"
        );

        PriceRequest storage priceRequest = _getPriceRequest(identifier, time, ancillaryData);
        require(
            _getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active,
            "Cannot commit inactive request"
        );

        priceRequest.lastVotingRound = currentRoundId;
        VoteInstance storage voteInstance = priceRequest.voteInstances[currentRoundId];
        voteInstance.voteSubmissions[msg.sender].commit = hash;

        emit VoteCommitted(msg.sender, currentRoundId, identifier, time, ancillaryData);
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function commitVote(
        bytes32 identifier,
        uint256 time,
        bytes32 hash
    ) public override onlyIfNotMigrated() {
        commitVote(identifier, time, "", hash);
    }

    // TODO: only here for ABI support until removed.
    function snapshotCurrentRound(bytes calldata signature)
        external
        override(VotingV2Interface, VotingAncillaryInterface)
        onlyIfNotMigrated()
    {}

    /**
     * @notice Reveal a previously committed vote for `identifier` at `time`.
     * @dev The revealed `price`, `salt`, `address`, `time`, `roundId`, and `identifier`, must hash to the latest `hash`
     * that `commitVote()` was called with. Only the committer can reveal their vote.
     * @param identifier voted on in the commit phase. EG BTC/USD price pair.
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
        require(voteTiming.computeCurrentPhase(getCurrentTime()) == Phase.Reveal, "Cannot reveal in commit phase");
        // Note: computing the current round is required to disallow people from revealing an old commit after the round is over.
        uint256 roundId = voteTiming.computeCurrentRoundId(getCurrentTime());

        PriceRequest storage priceRequest = _getPriceRequest(identifier, time, ancillaryData);
        VoteInstance storage voteInstance = priceRequest.voteInstances[roundId];
        VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[msg.sender];

        // Scoping to get rid of a stack too deep error.
        {
            // 0 hashes are disallowed in the commit phase, so they indicate a different error.
            // Cannot reveal an uncommitted or previously revealed hash
            require(voteSubmission.commit != bytes32(0), "Invalid hash reveal");
            require(
                keccak256(abi.encodePacked(price, salt, msg.sender, time, ancillaryData, roundId, identifier)) ==
                    voteSubmission.commit,
                "Revealed data != commit hash"
            );
        }

        delete voteSubmission.commit;

        // Get the voter's snapshotted balance. Since balances are returned pre-scaled by 10**18, we can directly
        // initialize the Unsigned value with the returned uint.
        FixedPoint.Unsigned memory balance = FixedPoint.Unsigned(voterStakes[msg.sender].cumulativeStaked);

        // Set the voter's submission.
        voteSubmission.revealHash = keccak256(abi.encode(price));

        // Add vote to the results.
        voteInstance.resultComputation.addVote(price, balance);

        emit VoteRevealed(msg.sender, roundId, identifier, time, price, ancillaryData, balance.rawValue);
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function revealVote(
        bytes32 identifier,
        uint256 time,
        int256 price,
        int256 salt
    ) public override {
        revealVote(identifier, time, price, "", salt);
    }

    /**
     * @notice commits a vote and logs an event with a data blob, typically an encrypted version of the vote
     * @dev An encrypted version of the vote is emitted in an event `EncryptedVote` to allow off-chain infrastructure to
     * retrieve the commit. The contents of `encryptedVote` are never used on chain: it is purely for convenience.
     * @param identifier unique price pair identifier. Eg: BTC/USD price pair.
     * @param time unix timestamp of for the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param hash keccak256 hash of the price you want to vote for and a `int256 salt`.
     * @param encryptedVote offchain encrypted blob containing the voters amount, time and salt.
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
        commitVote(identifier, time, "", hash);

        commitAndEmitEncryptedVote(identifier, time, "", hash, encryptedVote);
    }

    /**
     * @notice Submit a batch of commits in a single transaction.
     * @dev Using `encryptedVote` is optional. If included then commitment is emitted in an event.
     * Look at `project-root/common/Constants.js` for the tested maximum number of
     * commitments that can fit in one transaction.
     * @param commits struct to encapsulate an `identifier`, `time`, `hash` and optional `encryptedVote`.
     */
    function batchCommit(CommitmentAncillary[] memory commits) public override {
        for (uint256 i = 0; i < commits.length; i = unsafe_inc(i)) {
            if (commits[i].encryptedVote.length == 0) {
                commitVote(commits[i].identifier, commits[i].time, commits[i].ancillaryData, commits[i].hash);
            } else {
                commitAndEmitEncryptedVote(
                    commits[i].identifier,
                    commits[i].time,
                    commits[i].ancillaryData,
                    commits[i].hash,
                    commits[i].encryptedVote
                );
            }
        }
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function batchCommit(Commitment[] memory commits) public override {
        CommitmentAncillary[] memory commitsAncillary = new CommitmentAncillary[](commits.length);

        for (uint256 i = 0; i < commits.length; i = unsafe_inc(i)) {
            commitsAncillary[i].identifier = commits[i].identifier;
            commitsAncillary[i].time = commits[i].time;
            commitsAncillary[i].ancillaryData = "";
            commitsAncillary[i].hash = commits[i].hash;
            commitsAncillary[i].encryptedVote = commits[i].encryptedVote;
        }
        batchCommit(commitsAncillary);
    }

    /**
     * @notice Reveal multiple votes in a single transaction.
     * Look at `project-root/common/Constants.js` for the tested maximum number of reveals.
     * that can fit in one transaction.
     * @dev For more info on reveals, review the comment for `revealVote`.
     * @param reveals array of the Reveal struct which contains an identifier, time, price and salt.
     */
    function batchReveal(RevealAncillary[] memory reveals) public override {
        for (uint256 i = 0; i < reveals.length; i = unsafe_inc(i)) {
            revealVote(
                reveals[i].identifier,
                reveals[i].time,
                reveals[i].price,
                reveals[i].ancillaryData,
                reveals[i].salt
            );
        }
    }

    // Overloaded method to enable short term backwards compatibility. Will be deprecated in the next DVM version.
    function batchReveal(Reveal[] memory reveals) public override {
        RevealAncillary[] memory revealsAncillary = new RevealAncillary[](reveals.length);

        for (uint256 i = 0; i < reveals.length; i = unsafe_inc(i)) {
            revealsAncillary[i].identifier = reveals[i].identifier;
            revealsAncillary[i].time = reveals[i].time;
            revealsAncillary[i].price = reveals[i].price;
            revealsAncillary[i].ancillaryData = "";
            revealsAncillary[i].salt = reveals[i].salt;
        }
        batchReveal(revealsAncillary);
    }

    /****************************************
     *        VOTING GETTER FUNCTIONS       *
     ****************************************/

    /**
     * @notice Gets the queries that are being voted on this round.
     * @return pendingRequests array containing identifiers of type `PendingRequest`.
     * and timestamps for all pending requests.
     */
    function getPendingRequests()
        external
        view
        override(VotingV2Interface, VotingAncillaryInterface)
        returns (PendingRequestAncillary[] memory)
    {
        uint256 blockTime = getCurrentTime();
        uint256 currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        // Solidity memory arrays aren't resizable (and reading storage is expensive). Hence this hackery to filter
        // `pendingPriceRequests` only to those requests that have an Active RequestStatus.
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
     * @notice Returns the current voting phase, as a function of the current time.
     * @return Phase to indicate the current phase. Either { Commit, Reveal, NUM_PHASES_PLACEHOLDER }.
     */
    function getVotePhase() public view override(VotingV2Interface, VotingAncillaryInterface) returns (Phase) {
        return voteTiming.computeCurrentPhase(getCurrentTime());
    }

    /**
     * @notice Returns the current round ID, as a function of the current time.
     * @return uint256 representing the unique round ID.
     */
    function getCurrentRoundId() public view override(VotingV2Interface, VotingAncillaryInterface) returns (uint256) {
        return voteTiming.computeCurrentRoundId(getCurrentTime());
    }

    function getRoundEndTime(uint256 roundId) public view returns (uint256) {
        return voteTiming.computeRoundEndTime(roundId);
    }

    function getNumberOfPriceRequests() public view returns (uint256) {
        return priceRequestIds.length;
    }

    // TODO: remove this function. it's just here to make the contract compile given the interfaces.
    function retrieveRewards(
        address voterAddress,
        uint256 roundId,
        PendingRequestAncillary[] memory toRetrieve
    ) public override returns (FixedPoint.Unsigned memory) {}

    /****************************************
     *        OWNER ADMIN FUNCTIONS         *
     ****************************************/

    /**
     * @notice Disables this Voting contract in favor of the migrated one.
     * @dev Can only be called by the contract owner.
     * @param newVotingAddress the newly migrated contract address.
     */
    function setMigrated(address newVotingAddress)
        external
        override(VotingV2Interface, VotingAncillaryInterface)
        onlyOwner
    {
        migratedAddress = newVotingAddress;
    }

    // here for abi compatibility. remove
    function setInflationRate(FixedPoint.Unsigned memory newInflationRate)
        public
        override(VotingV2Interface, VotingAncillaryInterface)
        onlyOwner
    {}

    /**
     * @notice Resets the Gat percentage. Note: this change only applies to rounds that have not yet begun.
     * @dev This method is public because calldata structs are not currently supported by solidity.
     * @param newGatPercentage sets the next round's Gat percentage.
     */
    function setGatPercentage(FixedPoint.Unsigned memory newGatPercentage)
        public
        override(VotingV2Interface, VotingAncillaryInterface)
        onlyOwner
    {
        require(newGatPercentage.isLessThan(1), "GAT percentage must be < 100%");
        gatPercentage = newGatPercentage;
    }

    // Here for abi compatibility. to be removed.
    function setRewardsExpirationTimeout(uint256 NewRewardsExpirationTimeout)
        public
        override(VotingV2Interface, VotingAncillaryInterface)
        onlyOwner
    {}

    /**
     * @notice Changes the slashing library used by this contract.
     * @param _newSlashingLibrary new slashing library address.
     */
    function setSlashingLibrary(address _newSlashingLibrary) public override(VotingV2Interface) onlyOwner {
        slashingLibrary = SlashingLibrary(_newSlashingLibrary);
    }

    /****************************************
     *    PRIVATE AND INTERNAL FUNCTIONS    *
     ****************************************/

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
        if (requestStatus == RequestStatus.Active) {
            return (false, 0, "Current voting round not ended");
        } else if (requestStatus == RequestStatus.Resolved) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (, int256 resolvedPrice) =
                voteInstance.resultComputation.getResolvedPrice(_computeGat(priceRequest.lastVotingRound));
            return (true, resolvedPrice, "");
        } else if (requestStatus == RequestStatus.Future) {
            return (false, 0, "Price is still to be voted on");
        } else {
            return (false, 0, "Price was never requested");
        }
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
        if (rounds[roundId].gatPercentage.rawValue == 0) {
            // Set the round gat percentage to the current global gat rate.
            rounds[roundId].gatPercentage = gatPercentage;

            // Store the cumulativeStaked at this roundId to work out slashing and voting trackers.
            rounds[roundId].cumulativeStakedAtRound = cumulativeStaked;
        }
    }

    function _resolvePriceRequest(PriceRequest storage priceRequest, VoteInstance storage voteInstance) private {
        if (priceRequest.index == UINT_MAX) {
            return;
        }
        (bool isResolved, int256 resolvedPrice) =
            voteInstance.resultComputation.getResolvedPrice(_computeGat(priceRequest.lastVotingRound));
        require(isResolved, "Can't resolve unresolved request");

        // Delete the resolved price request from pendingPriceRequests.
        uint256 lastIndex = pendingPriceRequests.length - 1;
        PriceRequest storage lastPriceRequest = priceRequests[pendingPriceRequests[lastIndex]];
        lastPriceRequest.index = priceRequest.index;
        pendingPriceRequests[priceRequest.index] = pendingPriceRequests[lastIndex];
        pendingPriceRequests.pop();

        priceRequest.index = UINT_MAX;
        emit PriceResolved(
            priceRequest.lastVotingRound,
            priceRequest.identifier,
            priceRequest.time,
            resolvedPrice,
            priceRequest.ancillaryData
        );
    }

    function _computeGat(uint256 roundId) internal view returns (FixedPoint.Unsigned memory) {
        // Nothing staked at the round  - return max value to err on the side of caution.
        if (rounds[roundId].cumulativeStakedAtRound == 0) return FixedPoint.Unsigned(UINT_MAX);

        // Grab the cumulative staked at the voting round.
        FixedPoint.Unsigned memory stakedAtRound = FixedPoint.Unsigned(rounds[roundId].cumulativeStakedAtRound);

        // Multiply the total supply at the cumulative staked by the gatPercentage to get the GAT in number of tokens.
        return stakedAtRound.mul(rounds[roundId].gatPercentage);
    }

    function _getRequestStatus(PriceRequest storage priceRequest, uint256 currentRoundId)
        private
        view
        returns (RequestStatus)
    {
        if (priceRequest.lastVotingRound == 0) {
            return RequestStatus.NotRequested;
        } else if (priceRequest.lastVotingRound < currentRoundId) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (bool isResolved, ) =
                voteInstance.resultComputation.getResolvedPrice(_computeGat(priceRequest.lastVotingRound));

            return isResolved ? RequestStatus.Resolved : RequestStatus.Active;
        } else if (priceRequest.lastVotingRound == currentRoundId) {
            return RequestStatus.Active;
        } else {
            // Means than priceRequest.lastVotingRound > currentRoundId
            return RequestStatus.Future;
        }
    }

    function unsafe_inc(uint256 x) internal pure returns (uint256) {
        unchecked { return x + 1; }
    }

    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface supportedIdentifiers) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }
}
