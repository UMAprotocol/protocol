// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";
import "../../common/implementation/Testable.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";
import "../../merkle-distributor/implementation/MerkleDistributor.sol";
import "../../oracle/implementation/Constants.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../oracle/interfaces/OptimisticOracleInterface.sol";
import "../../oracle/interfaces/StoreInterface.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  OptimisticDistributor contract.
 * @notice Allows sponsors to distribute rewards through MerkleDistributor contract secured by UMA Optimistic Oracle.
 */
contract OptimisticDistributor is Lockable, MultiCaller, Testable {
    using SafeERC20 for IERC20;

    /********************************************
     *  OPTIMISTIC DISTRIBUTOR DATA STRUCTURES  *
     ********************************************/

    // Enum controlling acceptance of distribution payout proposals and their execution.
    enum DistributionProposed {
        None, // New proposal can be submitted (either there have been no proposals or the prior one was disputed).
        Pending, // Proposal is not yet resolved.
        Accepted // Proposal has been confirmed through Optimistic Oracle and rewards transferred to MerkleDistributor.
    }

    // Represents reward posted by a sponsor.
    struct Reward {
        DistributionProposed distributionProposed;
        address sponsor;
        IERC20 rewardToken;
        uint256 maximumRewardAmount;
        uint256 earliestProposalTimestamp;
        uint256 optimisticOracleProposerBond;
        uint256 optimisticOracleLivenessTime;
        bytes32 priceIdentifier;
        bytes customAncillaryData;
    }

    // Represents proposed rewards distribution.
    struct Proposal {
        uint256 rewardIndex;
        uint256 timestamp;
        bytes32 merkleRoot;
        string ipfsHash;
    }

    /********************************************
     *      STATE VARIABLES AND CONSTANTS       *
     ********************************************/

    // Reserve for bytes appended to ancillary data (e.g. OracleSpoke) when resolving price from non-mainnet chains.
    // This also covers appending rewardIndex by this contract.
    uint256 public constant ANCILLARY_BYTES_RESERVE = 512;

    // Restrict Optimistic Oracle liveness to between 10 minutes and 100 years.
    uint256 public constant MINIMUM_LIVENESS = 10 minutes;
    uint256 public constant MAXIMUM_LIVENESS = 5200 weeks;

    // Final fee can be synced and stored in the contract.
    uint256 public finalFee;

    // Ancillary data length limit can be synced and stored in the contract.
    uint256 public ancillaryBytesLimit;

    // Rewards are stored in dynamic array.
    Reward[] public rewards;

    // Proposals are mapped to hash of their identifier, timestamp and ancillaryData, so that they can be addressed
    // from OptimisticOracle callback function.
    mapping(bytes32 => Proposal) public proposals;

    // Immutable variables provided at deployment.
    FinderInterface public immutable finder;
    IERC20 public bondToken; // This cannot be declared immutable as bondToken needs to be checked against whitelist.

    // Merkle Distributor can be set only once.
    MerkleDistributor public merkleDistributor;

    // Interface parameters that can be synced and stored in the contract.
    StoreInterface public store;
    OptimisticOracleInterface public optimisticOracle;

    /********************************************
     *                  EVENTS                  *
     ********************************************/

    event RewardCreated(
        address indexed sponsor,
        IERC20 rewardToken,
        uint256 indexed rewardIndex,
        uint256 maximumRewardAmount,
        uint256 earliestProposalTimestamp,
        uint256 optimisticOracleProposerBond,
        uint256 optimisticOracleLivenessTime,
        bytes32 indexed priceIdentifier,
        bytes customAncillaryData
    );
    event RewardIncreased(uint256 indexed rewardIndex, uint256 newMaximumRewardAmount);
    event ProposalCreated(
        address indexed sponsor,
        IERC20 rewardToken,
        uint256 indexed rewardIndex,
        uint256 proposalTimestamp,
        uint256 maximumRewardAmount,
        bytes32 indexed proposalId,
        bytes32 merkleRoot,
        string ipfsHash
    );
    event RewardDistributed(
        address indexed sponsor,
        IERC20 rewardToken,
        uint256 indexed rewardIndex,
        uint256 maximumRewardAmount,
        bytes32 indexed proposalId,
        bytes32 merkleRoot,
        string ipfsHash
    );
    event ProposalRejected(uint256 indexed rewardIndex, bytes32 indexed proposalId);
    event MerkleDistributorSet(address indexed merkleDistributor);

    /**
     * @notice Constructor.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _finder Finder to look up UMA contract addresses.
     * @param _timer Contract that stores the current time in a testing environment.
     */
    constructor(
        FinderInterface _finder,
        IERC20 _bondToken,
        address _timer
    ) Testable(_timer) {
        finder = _finder;
        require(_getCollateralWhitelist().isOnWhitelist(address(_bondToken)), "Bond token not supported");
        bondToken = _bondToken;
        syncUmaEcosystemParams();
    }

    /********************************************
     *            FUNDING FUNCTIONS             *
     ********************************************/

    /**
     * @notice Allows any caller to create a Reward struct and deposit tokens that are linked to these rewards.
     * @dev The caller must approve this contract to transfer `maximumRewardAmount` amount of `rewardToken`.
     * @param rewardToken ERC20 token that the rewards will be paid in.
     * @param maximumRewardAmount Maximum reward amount that the sponsor is posting for distribution.
     * @param earliestProposalTimestamp Starting timestamp when proposals for distribution can be made.
     * @param priceIdentifier Identifier that should be passed to the Optimistic Oracle on proposed distribution.
     * @param customAncillaryData Custom ancillary data that should be sent to the Optimistic Oracle on proposed
     * distribution.
     * @param optimisticOracleProposerBond Amount of bondToken that should be posted in addition to final fee
     * to the Optimistic Oracle on proposed distribution.
     * @param optimisticOracleLivenessTime Liveness period in seconds during which proposed distribution can be
     * disputed through Optimistic Oracle.
     */
    function createReward(
        uint256 maximumRewardAmount,
        uint256 earliestProposalTimestamp,
        uint256 optimisticOracleProposerBond,
        uint256 optimisticOracleLivenessTime,
        bytes32 priceIdentifier,
        IERC20 rewardToken,
        bytes calldata customAncillaryData
    ) external nonReentrant() {
        require(address(merkleDistributor) != address(0), "Missing MerkleDistributor");
        require(_getIdentifierWhitelist().isIdentifierSupported(priceIdentifier), "Identifier not registered");
        require(_ancillaryDataWithinLimits(customAncillaryData), "Ancillary data too long");
        require(optimisticOracleLivenessTime >= MINIMUM_LIVENESS, "OO liveness too small");
        require(optimisticOracleLivenessTime < MAXIMUM_LIVENESS, "OO liveness too large");

        // Pull maximum rewards from the sponsor.
        rewardToken.safeTransferFrom(msg.sender, address(this), maximumRewardAmount);

        // Store funded reward and log created reward.
        Reward memory reward =
            Reward({
                distributionProposed: DistributionProposed.None,
                sponsor: msg.sender,
                rewardToken: rewardToken,
                maximumRewardAmount: maximumRewardAmount,
                earliestProposalTimestamp: earliestProposalTimestamp,
                optimisticOracleProposerBond: optimisticOracleProposerBond,
                optimisticOracleLivenessTime: optimisticOracleLivenessTime,
                priceIdentifier: priceIdentifier,
                customAncillaryData: customAncillaryData
            });
        uint256 rewardIndex = rewards.length;
        rewards.push() = reward;
        emit RewardCreated(
            reward.sponsor,
            reward.rewardToken,
            rewardIndex,
            reward.maximumRewardAmount,
            reward.earliestProposalTimestamp,
            reward.optimisticOracleProposerBond,
            reward.optimisticOracleLivenessTime,
            reward.priceIdentifier,
            reward.customAncillaryData
        );
    }

    /**
     * @notice Allows anyone to deposit additional rewards for distribution before `earliestProposalTimestamp`.
     * @dev The caller must approve this contract to transfer `additionalRewardAmount` amount of `rewardToken`.
     * @param rewardIndex Index for identifying existing Reward struct that should receive additional funding.
     * @param additionalRewardAmount Additional reward amount that the sponsor is posting for distribution.
     */
    function increaseReward(uint256 rewardIndex, uint256 additionalRewardAmount) external nonReentrant() {
        require(rewardIndex < rewards.length, "Invalid rewardIndex");
        require(getCurrentTime() < rewards[rewardIndex].earliestProposalTimestamp, "Funding period ended");

        // Pull additional rewards from the sponsor.
        rewards[rewardIndex].rewardToken.safeTransferFrom(msg.sender, address(this), additionalRewardAmount);

        // Update maximumRewardAmount and log new amount.
        rewards[rewardIndex].maximumRewardAmount += additionalRewardAmount;
        emit RewardIncreased(rewardIndex, rewards[rewardIndex].maximumRewardAmount);
    }

    /********************************************
     *          DISTRIBUTION FUNCTIONS          *
     ********************************************/

    /**
     * @notice Allows any caller to propose distribution for funded reward starting from `earliestProposalTimestamp`.
     * Only one undisputed proposal at a time is allowed.
     * @dev The caller must approve this contract to transfer `optimisticOracleProposerBond` + final fee amount
     * of `bondToken`.
     * @param rewardIndex Index for identifying existing Reward struct that should be proposed for distribution.
     * @param merkleRoot Merkle root describing allocation of proposed rewards distribution.
     * @param ipfsHash Hash of IPFS object, conveniently stored for clients to verify proposed distribution.
     */
    function proposeDistribution(
        uint256 rewardIndex,
        bytes32 merkleRoot,
        string calldata ipfsHash
    ) external nonReentrant() {
        require(rewardIndex < rewards.length, "Invalid rewardIndex");

        uint256 timestamp = getCurrentTime();
        Reward memory reward = rewards[rewardIndex];
        require(timestamp >= reward.earliestProposalTimestamp, "Cannot propose in funding period");
        require(reward.distributionProposed == DistributionProposed.None, "New proposals blocked");

        // Flag reward as proposed so that any subsequent proposals are blocked till dispute.
        rewards[rewardIndex].distributionProposed = DistributionProposed.Pending;

        // Append rewardIndex to ancillary data.
        bytes memory ancillaryData = _appendRewardIndex(rewardIndex, reward.customAncillaryData);

        // Generate hash for proposalId.
        bytes32 proposalId = _getProposalId(reward.priceIdentifier, timestamp, ancillaryData);

        // Request price from Optimistic Oracle.
        optimisticOracle.requestPrice(reward.priceIdentifier, timestamp, ancillaryData, bondToken, 0);

        // Set proposal liveness and bond and calculate total bond amount.
        optimisticOracle.setCustomLiveness(
            reward.priceIdentifier,
            timestamp,
            ancillaryData,
            reward.optimisticOracleLivenessTime
        );
        uint256 totalBond =
            optimisticOracle.setBond(
                reward.priceIdentifier,
                timestamp,
                ancillaryData,
                reward.optimisticOracleProposerBond
            );

        // Pull proposal bond and final fee from the proposer, and approve it for Optimistic Oracle.
        bondToken.safeTransferFrom(msg.sender, address(this), totalBond);
        bondToken.safeApprove(address(optimisticOracle), totalBond);

        // Propose canonical value representing "True"; i.e. the proposed distribution is valid.
        optimisticOracle.proposePriceFor(
            msg.sender,
            address(this),
            reward.priceIdentifier,
            timestamp,
            ancillaryData,
            int256(1e18)
        );

        // Store and log proposed distribution.
        proposals[proposalId] = Proposal({
            rewardIndex: rewardIndex,
            timestamp: timestamp,
            merkleRoot: merkleRoot,
            ipfsHash: ipfsHash
        });
        emit ProposalCreated(
            reward.sponsor,
            reward.rewardToken,
            rewardIndex,
            timestamp,
            reward.maximumRewardAmount,
            proposalId,
            merkleRoot,
            ipfsHash
        );
    }

    /**
     * @notice Allows any caller to execute distribution that has been validated by the Optimistic Oracle.
     * @param proposalId Hash for identifying existing rewards distribution proposal.
     * @dev Calling this for unresolved proposals will revert.
     */
    function executeDistribution(bytes32 proposalId) external nonReentrant() {
        // All valid proposals should have non-zero proposal timestamp.
        Proposal memory proposal = proposals[proposalId];
        require(proposal.timestamp != 0, "Invalid proposalId");

        // Only one validated proposal per reward can be executed for distribution.
        Reward memory reward = rewards[proposal.rewardIndex];
        require(reward.distributionProposed != DistributionProposed.Accepted, "Reward already distributed");

        // Append reward index to ancillary data.
        bytes memory ancillaryData = _appendRewardIndex(proposal.rewardIndex, reward.customAncillaryData);

        // Get resolved price. Reverts if the request is not settled or settleable.
        int256 resolvedPrice =
            optimisticOracle.settleAndGetPrice(reward.priceIdentifier, proposal.timestamp, ancillaryData);

        // Transfer rewards to MerkleDistributor for accepted proposal and flag distributionProposed Accepted.
        if (resolvedPrice == 1e18) {
            rewards[proposal.rewardIndex].distributionProposed = DistributionProposed.Accepted;

            reward.rewardToken.safeApprove(address(merkleDistributor), reward.maximumRewardAmount);
            merkleDistributor.setWindow(
                reward.maximumRewardAmount,
                address(reward.rewardToken),
                proposal.merkleRoot,
                proposal.ipfsHash
            );
            emit RewardDistributed(
                reward.sponsor,
                reward.rewardToken,
                proposal.rewardIndex,
                reward.maximumRewardAmount,
                proposalId,
                proposal.merkleRoot,
                proposal.ipfsHash
            );
        } else emit ProposalRejected(proposal.rewardIndex, proposalId);
    }

    /********************************************
     *          MAINTENANCE FUNCTIONS           *
     ********************************************/

    /**
     * @notice Sets address of MerkleDistributor contract that will be used for rewards distribution.
     * MerkleDistributor address can only be set once.
     * @dev It is expected that the deployer first deploys MekleDistributor contract and transfers its ownership to
     * the OptimisticDistributor contract and then calls `setMerkleDistributor` on the OptimisticDistributor pointing
     * on now owned MekleDistributor contract.
     * @param _merkleDistributor Address of the owned MerkleDistributor contract.
     */
    function setMerkleDistributor(MerkleDistributor _merkleDistributor) external nonReentrant() {
        require(address(merkleDistributor) == address(0), "MerkleDistributor already set");
        require(_merkleDistributor.owner() == address(this), "MerkleDistributor not owned");

        merkleDistributor = _merkleDistributor;
        emit MerkleDistributorSet(address(_merkleDistributor));
    }

    /**
     * @notice Updates the address stored in this contract for the OptimisticOracle and the Store to the latest
     * versions set in the Finder. Also pull finalFee from Store contract.
     * @dev There is no risk of leaving this function public for anyone to call as in all cases we want the addresses
     * in this contract to map to the latest version in the Finder and store the latest final fee.
     */
    function syncUmaEcosystemParams() public nonReentrant() {
        store = _getStore();
        finalFee = store.computeFinalFee(address(bondToken)).rawValue;
        optimisticOracle = _getOptimisticOracle();
        ancillaryBytesLimit = optimisticOracle.ancillaryBytesLimit();
    }

    /********************************************
     *            CALLBACK FUNCTIONS            *
     ********************************************/

    /**
     * @notice Unblocks new distribution proposals when there is a dispute posted on OptimisticOracle.
     * @dev Only accessable as callback through OptimisticOracle on disputes.
     * @param identifier Price identifier from original proposal.
     * @param timestamp Timestamp when distribution proposal was posted.
     * @param ancillaryData Ancillary data of the price being requested (includes stamped rewardIndex).
     * @param refund Refund received (not used in this contract).
     */
    function priceDisputed(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 refund
    ) public nonReentrant() {
        require(msg.sender == address(optimisticOracle), "Not authorized");

        // Identify the proposed distribution from callback parameters.
        bytes32 proposalId = _getProposalId(identifier, timestamp, ancillaryData);

        // Flag the associated reward unblocked for new distribution proposals.
        rewards[proposals[proposalId].rewardIndex].distributionProposed = DistributionProposed.None;
    }

    /********************************************
     *            INTERNAL FUNCTIONS            *
     ********************************************/

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _appendRewardIndex(uint256 rewardIndex, bytes memory customAncillaryData)
        internal
        view
        returns (bytes memory)
    {
        return AncillaryData.appendKeyValueUint(customAncillaryData, "rewardIndex", rewardIndex);
    }

    function _ancillaryDataWithinLimits(bytes memory customAncillaryData) internal view returns (bool) {
        // Since rewardIndex has variable length as string, it is not appended here and is assumed
        // to be included in ANCILLARY_BYTES_RESERVE.
        return
            optimisticOracle.stampAncillaryData(customAncillaryData, address(this)).length + ANCILLARY_BYTES_RESERVE <=
            ancillaryBytesLimit;
    }

    function _getProposalId(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(identifier, timestamp, ancillaryData));
    }
}
