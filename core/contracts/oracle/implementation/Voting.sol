pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";
import "../interfaces/FinderInterface.sol";
import "../interfaces/OracleInterface.sol";
import "../interfaces/VotingInterface.sol";
import "../interfaces/IdentifierWhitelistInterface.sol";
import "./EncryptedStore.sol";
import "./Registry.sol";
import "./ResultComputation.sol";
import "./VoteTiming.sol";
import "./VotingToken.sol";

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * @title Voting system for Oracle.
 * @dev Handles receiving and resolving price requests via a commit-reveal voting scheme.
 */
contract Voting is Testable, Ownable, OracleInterface, VotingInterface, EncryptedStore {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint;
    using VoteTiming for VoteTiming.Data;
    using ResultComputation for ResultComputation.Data;

    /****************************************
     *        VOTING DATA STRUCTURES        *
     ****************************************/

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

    struct Round {
        uint snapshotId; // Voting token snapshot ID for this round.  0 if no snapshot has been taken.
        FixedPoint.Unsigned inflationRate; // Inflation rate set for this round.
        FixedPoint.Unsigned gatPercentage; // Gat rate set for this round.
        uint rewardsExpirationTime; // Time that rewards for this round can be claimed until.
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
        uint lastVotingRound;
    }

    /****************************************
     *          INTERNAL TRACKING           *
     ****************************************/

    // Maps round numbers to the rounds.
    mapping(uint => Round) public rounds;

    // Maps price request IDs to the PriceRequest struct.
    mapping(bytes32 => PriceRequest) private priceRequests;

    // Price request ids for price requests that haven't yet been marked as resolved.
    // These requests may be for future rounds.
    bytes32[] private pendingPriceRequests;

    VoteTiming.Data public voteTiming;

    IdentifierWhitelistInterface public identifierWhitelist;

    // Percentage of the total token supply that must be used in a vote to
    // create a valid price resolution. 1 == 100%.
    FixedPoint.Unsigned public gatPercentage;

    // Global setting for the rate of inflation per vote. This is the percentage of the snapshotted total supply that
    // should be split among the correct voters. Note: this value is used to set per-round inflation at the beginning
    // of each round. 1 = 100%
    FixedPoint.Unsigned public inflationRate;

    // Time in seconds from the end of the round in which a price request is
    // resolved that voters can still claim their rewards.
    uint public rewardsExpirationTimeout;

    // Reference to the voting token.
    VotingToken public votingToken;

    // Reference to the Finder.
    FinderInterface private finder;

    // If non-zero, this contract has been migrated to this address. All voters and
    // financial contracts should query the new address only.
    address public migratedAddress;

    // Max value of an unsigned integer.
    uint private constant UINT_MAX = ~uint(0);

    /***************************************
     *                EVENTS                *
     ****************************************/

    event VoteCommitted(address indexed voter, uint indexed roundId, bytes32 indexed identifier, uint time);

    event VoteRevealed(
        address indexed voter,
        uint indexed roundId,
        bytes32 indexed identifier,
        uint time,
        int price,
        uint numTokens
    );

    event RewardsRetrieved(
        address indexed voter,
        uint indexed roundId,
        bytes32 indexed identifier,
        uint time,
        uint numTokens
    );

    event PriceRequestAdded(uint indexed votingRoundId, bytes32 indexed identifier, uint time);

    event PriceResolved(uint indexed resolutionRoundId, bytes32 indexed identifier, uint time, int price);

    /**
     * @notice Construct the Voting contract.
     * @param _phaseLength length of the commit and reveal phases in seconds.
     * @param _gatPercentage of the total token supply that must be used in a vote to create a valid price resolution.
     * @param _inflationRate percentage inflation per round used to increase token supply of correct voters.
     * @param _rewardsExpirationTimeout timeout, in seconds, within which rewards must be claimed.
     * @param _votingToken address of the UMA token contract used to commit votes.
     * @param _identifierWhitelist defines the identifiers that can have have synthetics created against.
     * @param _finder keeps track of all contracts within the system based on their interfaceName.
     * @param _isTest whether this contract is being constructed for the purpose of running automated tests.
     */
    constructor(
        uint _phaseLength,
        FixedPoint.Unsigned memory _gatPercentage,
        FixedPoint.Unsigned memory _inflationRate,
        uint _rewardsExpirationTimeout,
        address _votingToken,
        address _identifierWhitelist,
        address _finder,
        bool _isTest
    ) public Testable(_isTest) {
        voteTiming.init(_phaseLength);
        require(_gatPercentage.isLessThanOrEqual(1), "GAT percentage must be <= 100%");
        gatPercentage = _gatPercentage;
        inflationRate = _inflationRate;
        votingToken = VotingToken(_votingToken);
        identifierWhitelist = IdentifierWhitelistInterface(_identifierWhitelist);
        finder = FinderInterface(_finder);
        rewardsExpirationTimeout = _rewardsExpirationTimeout;
    }

    /***************************************
                    MODIFIERS
    ****************************************/

    modifier onlyRegisteredContract() {
        if (migratedAddress != address(0)) {
            require(msg.sender == migratedAddress);
        } else {
            Registry registry = Registry(finder.getImplementationAddress("Registry"));
            require(registry.isContractRegistered(msg.sender));
        }
        _;
    }

    modifier onlyIfNotMigrated() {
        require(migratedAddress == address(0));
        _;
    }

    /****************************************
     *  PRICE REQUEST AND ACCESS FUNCTIONS  *
     ****************************************/

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given `identifier`, `time` pair.
     * @dev Time must be in the past and the identifier must be supported.
     * @param identifier uniquely identifies the price requested. eg BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of for the price request.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function requestPrice(bytes32 identifier, uint time) external override onlyRegisteredContract() {
        uint blockTime = getCurrentTime();
        require(time <= blockTime, "Can only request in past");
        require(identifierWhitelist.isIdentifierSupported(identifier), "Unsupported identifier request");

        bytes32 priceRequestId = _encodePriceRequest(identifier, time);
        PriceRequest storage priceRequest = priceRequests[priceRequestId];
        uint currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);

        if (requestStatus == RequestStatus.NotRequested) {
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
        }
    }

    /**
     * @notice Whether the price for `identifier` and `time` is available.
     * @dev Time must be in the past and the identifier must be supported.
     * @param identifier uniquely identifies the price requested. eg BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of for the price request.
     * @return _hasPrice bool if the DVM has resolved to a price for the given identifier and timestamp.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function hasPrice(bytes32 identifier, uint time) external override view onlyRegisteredContract() returns (bool _hasPrice) {
        (_hasPrice, , ) = _getPriceOrError(identifier, time);
    }

    /**
     * @notice Gets the price for `identifier` and `time` if it has already been requested and resolved.
     * @dev If the price is not available, the method reverts.
     * @param identifier uniquely identifies the price requested. eg BTC/USD (encoded as bytes32) could be requested.
     * @param time unix timestamp of for the price request.
     * @return int representing the resolved price for the given identifier and timestamp.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getPrice(bytes32 identifier, uint time) external override view onlyRegisteredContract() returns (int) {
        (bool _hasPrice, int price, string memory message) = _getPriceOrError(identifier, time);

        // If the price wasn't available, revert with the provided message.
        require(_hasPrice, message);
        return price;
    }

    /**
     * @notice Gets the status of a list of price requests, identified by their identifier and time.
     * @dev If the status for a particular request is NotRequested, the lastVotingRound will always be 0.
     * @param requests array of time PendingRequest which includes a identifier and timestamp for each request.
     * @return requestStates A lis, in the same order as the input list, giving the status of each of the specified price requests.
     */
    function getPriceRequestStatuses(PendingRequest[] memory requests)
        public
        view
        returns (RequestState[] memory requestStates)
    {
        requestStates = new RequestState[](requests.length);
        uint currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        for (uint i = 0; i < requests.length; i++) {
            PriceRequest storage priceRequest = _getPriceRequest(requests[i].identifier, requests[i].time);

            RequestStatus status = _getRequestStatus(priceRequest, currentRoundId);

            // If it's an active request, its true lastVotingRound is the current one, even if it hasn't been updated.
            if (status == RequestStatus.Active) {
                requestStates[i].lastVotingRound = currentRoundId;
            } else {
                requestStates[i].lastVotingRound = priceRequest.lastVotingRound;
            }

            requestStates[i].status = status;
        }
    }

    /****************************************
     *            VOTING FUNCTIONS          *
     ****************************************/

    /**
     * @notice Commit a vote for a price request for `identifier` at `time`.
     * @dev `identifier`, `time` must correspond to a price request that's currently in the commit phase.
     * Commits can be changed.
     * @param identifier uniquely identifies the committed vote. EG BTC/USD price pair.
     * @param time unix timestamp of the price is being voted on.
     * @param hash keccak256 hash of the price you want to vote for and a `int salt`.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function commitVote(bytes32 identifier, uint time, bytes32 hash) public override onlyIfNotMigrated() {
        require(hash != bytes32(0), "Invalid provided hash");
        // Current time is required for all vote timing queries.
        uint blockTime = getCurrentTime();
        require(voteTiming.computeCurrentPhase(blockTime) == Phase.Commit, "Cannot commit in reveal phase");

        // At this point, the computed and last updated round ID should be equal.
        uint currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        PriceRequest storage priceRequest = _getPriceRequest(identifier, time);
        require(
            _getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active,
            "Cannot commit inactive request"
        );

        priceRequest.lastVotingRound = currentRoundId;
        VoteInstance storage voteInstance = priceRequest.voteInstances[currentRoundId];
        voteInstance.voteSubmissions[msg.sender].commit = hash;

        emit VoteCommitted(msg.sender, currentRoundId, identifier, time);
    }

    /**
     * @notice Reveal a previously committed vote for `identifier` at `time`.
     * @dev The revealed `price` and `salt` must match the latest `hash` that `commitVote()` was called with.
     * Only the committer can reveal their vote.
     * @param identifier voted on in the commit phase. EG BTC/USD price pair.
     * @param time specifies the unix timestamp of the price is being voted on.
     * @param price voted on during the commit phase.
     * @param salt value used to hide the commitment price during the commit phase.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function revealVote(bytes32 identifier, uint time, int price, int salt) public override onlyIfNotMigrated() {
        uint blockTime = getCurrentTime();
        require(voteTiming.computeCurrentPhase(blockTime) == Phase.Reveal, "Cannot reveal in commit phase");
        // Note: computing the current round is required to disallow people from revealing an old commit after the
        // round is over.
        uint roundId = voteTiming.computeCurrentRoundId(blockTime);

        PriceRequest storage priceRequest = _getPriceRequest(identifier, time);
        VoteInstance storage voteInstance = priceRequest.voteInstances[roundId];
        VoteSubmission storage voteSubmission = voteInstance.voteSubmissions[msg.sender];

        // 0 hashes are disallowed in the commit phase, so they indicate a different error.
        // Cannot reveal an uncommitted or previously revealed hash
        require(voteSubmission.commit != bytes32(0), "Invalid hash reveal");
        // Committed hash doesn't match revealed price and salt
        require(keccak256(abi.encode(price, salt)) == voteSubmission.commit, "Invalid commit hash & salt");
        delete voteSubmission.commit;

        // Lock in round variables including snapshotId and inflation rate
        _freezeRoundVariables(roundId);

        // Get the frozen snapshotId
        uint snapshotId = rounds[roundId].snapshotId;

        // Get the voter's snapshotted balance. Since balances are returned pre-scaled by 10**18, we can directly
        // initialize the Unsigned value with the returned uint.
        FixedPoint.Unsigned memory balance = FixedPoint.Unsigned(votingToken.balanceOfAt(msg.sender, snapshotId));

        // Set the voter's submission.
        voteSubmission.revealHash = keccak256(abi.encode(price));

        // Add vote to the results.
        voteInstance.resultComputation.addVote(price, balance);

        // Remove the stored message for this price request, if it exists.
        bytes32 topicHash = keccak256(abi.encode(identifier, time, roundId));
        removeMessage(topicHash);

        emit VoteRevealed(msg.sender, roundId, identifier, time, price, balance.rawValue);
    }

    /**
     * @notice commits a vote and stores an encrypted version which can be later decrypted
     * to recover the voter's price & salt.
     * @dev The encryption mechanism uses encrypt from a signature from a users price key. See `EncryptedSender.sol`
     * @param identifier unique price pair identifier. Eg: BTC/USD price pair.
     * @param time unix timestamp of for the price request.
     * @param hash keccak256 hash of the price you want to vote for and a `int salt`.
     * @param encryptedVote offchain encrypted blob containing the voters amount, time and salt.
     */
    function commitAndPersistEncryptedVote(bytes32 identifier, uint time, bytes32 hash, bytes memory encryptedVote)
        public
    {
        commitVote(identifier, time, hash);

        uint roundId = voteTiming.computeCurrentRoundId(getCurrentTime());
        bytes32 topicHash = keccak256(abi.encode(identifier, time, roundId));
        storeMessage(topicHash, encryptedVote);
    }

    /**
     * @notice Submit a batch of commits in a single transaction.
     * @dev Using `encryptedVote` is optional. If included then commitment is stored on chain.
     * Look at `project-root/common/Constants.js` for the tested maximum number of
     * commitments that can fit in one transaction.
     * @param commits struct to encapsulate an `identifier`, `time`, `hash` and optional `encryptedVote`.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function batchCommit(Commitment[] calldata commits) external override {
        for (uint i = 0; i < commits.length; i++) {
            if (commits[i].encryptedVote.length == 0) {
                commitVote(commits[i].identifier, commits[i].time, commits[i].hash);
            } else {
                commitAndPersistEncryptedVote(
                    commits[i].identifier,
                    commits[i].time,
                    commits[i].hash,
                    commits[i].encryptedVote
                );
            }
        }
    }

    /**
     * @notice Reveal multiple votes in a single transaction.
     * Look at `project-root/common/Constants.js` for the tested maximum number of reveals.
     * that can fit in one transaction.
     * @dev For more information on reveals, review the comment for `revealVote`.
     * @param reveals array of the Reveal struct which contains an identifier, time, price and salt.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function batchReveal(Reveal[] calldata reveals) external override {
        for (uint i = 0; i < reveals.length; i++) {
            revealVote(reveals[i].identifier, reveals[i].time, reveals[i].price, reveals[i].salt);
        }
    }

    /**
     * @notice Retrieves rewards owed for a set of resolved price requests.
     * @dev Can only retrieve rewards if calling for a valid round and if the
     * call is done within the timeout threshold (not expired).
     * @param voterAddress voter for which rewards will be retrieved. Does not have to be the caller.
     * @param roundId the round from which voting rewards will be retrieved from.
     * @param toRetrieve array of PendingRequests which rewards are retrieved from.
     * @return totalRewardToIssue total amount of rewards returned to the voter.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function retrieveRewards(address voterAddress, uint roundId, PendingRequest[] memory toRetrieve)
        public
        override 
        returns (FixedPoint.Unsigned memory totalRewardToIssue)
    {
        if (migratedAddress != address(0)) {
            require(msg.sender == migratedAddress, "Can only call from migrated");
        }
        uint blockTime = getCurrentTime();
        require(roundId < voteTiming.computeCurrentRoundId(blockTime), "Invalid roundId");

        Round storage round = rounds[roundId];
        bool isExpired = blockTime > round.rewardsExpirationTime;
        FixedPoint.Unsigned memory snapshotBalance = FixedPoint.Unsigned(
            votingToken.balanceOfAt(voterAddress, round.snapshotId)
        );

        // Compute the total amount of reward that will be issued for each of the votes in the round.
        FixedPoint.Unsigned memory snapshotTotalSupply = FixedPoint.Unsigned(
            votingToken.totalSupplyAt(round.snapshotId)
        );
        FixedPoint.Unsigned memory totalRewardPerVote = round.inflationRate.mul(snapshotTotalSupply);

        // Keep track of the voter's accumulated token reward.
        totalRewardToIssue = FixedPoint.Unsigned(0);

        for (uint i = 0; i < toRetrieve.length; i++) {
            PriceRequest storage priceRequest = _getPriceRequest(toRetrieve[i].identifier, toRetrieve[i].time);
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            // Only retrieve rewards for votes resolved in same round
            require(priceRequest.lastVotingRound == roundId, "Retrieve for votes same round");

            _resolvePriceRequest(priceRequest, voteInstance);

            if (isExpired) {
                // Emit a 0 token retrieval on expired rewards.
                emit RewardsRetrieved(voterAddress, roundId, toRetrieve[i].identifier, toRetrieve[i].time, 0);
            } else if (
                voteInstance.resultComputation.wasVoteCorrect(voteInstance.voteSubmissions[voterAddress].revealHash)
            ) {
                // The price was successfully resolved during the voter's last voting round, the voter revealed
                // and was correct, so they are eligible for a reward.
                // Compute the reward and add to the cumulative reward.
                FixedPoint.Unsigned memory reward = snapshotBalance.mul(totalRewardPerVote).div(
                    voteInstance.resultComputation.getTotalCorrectlyVotedTokens()
                );
                totalRewardToIssue = totalRewardToIssue.add(reward);

                // Emit reward retrieval for this vote.
                emit RewardsRetrieved(
                    voterAddress,
                    roundId,
                    toRetrieve[i].identifier,
                    toRetrieve[i].time,
                    reward.rawValue
                );
            } else {
                // Emit a 0 token retrieval on incorrect votes.
                emit RewardsRetrieved(voterAddress, roundId, toRetrieve[i].identifier, toRetrieve[i].time, 0);
            }

            // Delete the submission to capture any refund and clean up storage.
            delete voteInstance.voteSubmissions[voterAddress].revealHash;
        }

        // Issue any accumulated rewards.
        if (totalRewardToIssue.isGreaterThan(0)) {
            require(votingToken.mint(voterAddress, totalRewardToIssue.rawValue), "Voting token issuance failed");
        }
    }

    /****************************************
     *        VOTING GETTER FUNCTIONS       *
     ****************************************/

    /**
     * @notice Gets the queries that are being voted on this round.
     * @return pendingRequests `PendingRequest` array containing identifiers
     * and timestamps for all pending requests.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getPendingRequests() external override view returns (PendingRequest[] memory pendingRequests) {
        uint blockTime = getCurrentTime();
        uint currentRoundId = voteTiming.computeCurrentRoundId(blockTime);

        // Solidity memory arrays aren't resizable (and reading storage is expensive). Hence this hackery to filter
        // `pendingPriceRequests` only to those requests that `isActive()`.
        PendingRequest[] memory unresolved = new PendingRequest[](pendingPriceRequests.length);
        uint numUnresolved = 0;

        for (uint i = 0; i < pendingPriceRequests.length; i++) {
            PriceRequest storage priceRequest = priceRequests[pendingPriceRequests[i]];
            if (_getRequestStatus(priceRequest, currentRoundId) == RequestStatus.Active) {
                unresolved[numUnresolved] = PendingRequest({
                    identifier: priceRequest.identifier,
                    time: priceRequest.time
                });
                numUnresolved++;
            }
        }

        pendingRequests = new PendingRequest[](numUnresolved);
        for (uint i = 0; i < numUnresolved; i++) {
            pendingRequests[i] = unresolved[i];
        }
    }

    /**
     * @notice Returns the current voting phase, as a function of the current time.
     * @return Phase to indicate the current phase. Either { Commit, Reveal, NUM_PHASES_PLACEHOLDER }.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getVotePhase() external override view returns (Phase) {
        return voteTiming.computeCurrentPhase(getCurrentTime());
    }

    /**
     * @notice Returns the current round ID, as a function of the current time.
     * @return uint representing the unique round ID.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getCurrentRoundId() external override view returns (uint) {
        return voteTiming.computeCurrentRoundId(getCurrentTime());
    }

    /****************************************
     *        OWNER ADMIN FUNCTIONS         *
     ****************************************/

    /**
     * @notice Disables this Voting contract in favor of the migrated one.
     * @dev Can only be called by the contract owner.
     */
    function setMigrated(address newVotingAddress) external onlyOwner {
        migratedAddress = newVotingAddress;
    }

    /**
     * @notice Resets the inflation rate. Note: this change only applies to rounds that have not yet begun.
     * @dev This method is public because calldata structs are not currently supported by solidity.
     * @param newInflationRate sets the next rounds inflation rate.
     */
    function setInflationRate(FixedPoint.Unsigned memory newInflationRate) public onlyOwner {
        inflationRate = newInflationRate;
    }

    /**
     * @notice Resets the Gat percentage. Note: this change only applies to rounds that have not yet begun.
     * @dev This method is public because calldata structs are not currently supported by solidity.
     * @param newGatPercentage sets the next rounds Gat percentage.
     */
    function setGatPercentage(FixedPoint.Unsigned memory newGatPercentage) public onlyOwner {
        require(newGatPercentage.isLessThan(1), "GAT percentage must be < 100%");
        gatPercentage = newGatPercentage;
    }

    /**
     * @notice Resets the rewards expiration timeout.
     * @dev This change only applies to rounds that have not yet begun.
     * @param NewRewardsExpirationTimeout how long a caller can wait before choosing to withdraw their rewards.
     */
    function setRewardsExpirationTimeout(uint NewRewardsExpirationTimeout) public onlyOwner {
        rewardsExpirationTimeout = NewRewardsExpirationTimeout;
    }

    /****************************************
     *    PRIVATE AND INTERNAL FUNCTIONS    *
     ****************************************/

    function _getPriceOrError(bytes32 identifier, uint time)
        private
        view
        returns (bool _hasPrice, int price, string memory err)
    {
        PriceRequest storage priceRequest = _getPriceRequest(identifier, time);
        uint currentRoundId = voteTiming.computeCurrentRoundId(getCurrentTime());

        RequestStatus requestStatus = _getRequestStatus(priceRequest, currentRoundId);
        if (requestStatus == RequestStatus.Active) {
            return (false, 0, "Current voting round not ended");
        } else if (requestStatus == RequestStatus.Resolved) {
            VoteInstance storage voteInstance = priceRequest.voteInstances[priceRequest.lastVotingRound];
            (, int resolvedPrice) = voteInstance.resultComputation.getResolvedPrice(
                _computeGat(priceRequest.lastVotingRound)
            );
            return (true, resolvedPrice, "");
        } else if (requestStatus == RequestStatus.Future) {
            return (false, 0, "Price is still to be voted on");
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

    function _freezeRoundVariables(uint roundId) private {
        Round storage round = rounds[roundId];
        // Only on the first reveal should the snapshot be captured for that round.
        if (round.snapshotId == 0) {
            // There is no snapshot ID set, so create one.
            round.snapshotId = votingToken.snapshot();

            // Set the round inflation rate to the current global inflation rate.
            rounds[roundId].inflationRate = inflationRate;

            // Set the round gat percentage to the current global gat rate.
            rounds[roundId].gatPercentage = gatPercentage;

            // Set the rewards expiration time based on end of time of this round and the current global timeout.
            rounds[roundId].rewardsExpirationTime = voteTiming.computeRoundEndTime(roundId) + rewardsExpirationTimeout;
        }
    }

    function _resolvePriceRequest(PriceRequest storage priceRequest, VoteInstance storage voteInstance) private {
        if (priceRequest.index == UINT_MAX) {
            return;
        }
        (bool isResolved, int resolvedPrice) = voteInstance.resultComputation.getResolvedPrice(
            _computeGat(priceRequest.lastVotingRound)
        );
        require(isResolved, "Can't resolve unresolved request");

        // Delete the resolved price request from pendingPriceRequests.
        uint lastIndex = pendingPriceRequests.length - 1;
        PriceRequest storage lastPriceRequest = priceRequests[pendingPriceRequests[lastIndex]];
        lastPriceRequest.index = priceRequest.index;
        pendingPriceRequests[priceRequest.index] = pendingPriceRequests[lastIndex];
        delete pendingPriceRequests[lastIndex];

        priceRequest.index = UINT_MAX;
        emit PriceResolved(priceRequest.lastVotingRound, priceRequest.identifier, priceRequest.time, resolvedPrice);
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
        return snapshottedSupply.mul(rounds[roundId].gatPercentage);
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
                _computeGat(priceRequest.lastVotingRound)
            );
            return isResolved ? RequestStatus.Resolved : RequestStatus.Active;
        } else if (priceRequest.lastVotingRound == currentRoundId) {
            return RequestStatus.Active;
        } else {
            // Means than priceRequest.lastVotingRound > currentRoundId
            return RequestStatus.Future;
        }
    }
}
