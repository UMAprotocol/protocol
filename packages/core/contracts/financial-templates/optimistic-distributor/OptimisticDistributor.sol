// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";
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
contract OptimisticDistributor is Lockable, MultiCaller {
    using SafeERC20 for IERC20;

    /********************************************
     *  OPTIMISTIC DISTRIBUTOR DATA STRUCTURES  *
     ********************************************/

    // Represents reward posted by a sponsor.
    struct Reward {
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
     *      INTERNAL VARIABLES AND STORAGE      *
     ********************************************/

    // Reserve for bytes appended to ancillary data (e.g. OracleSpoke) when resolving price from non-mainnet chains.
    // This also covers appending proposalIndex by this contract.
    uint256 public constant ANCILLARY_BYTES_RESERVE = 512;

    // Restrict Optimistic Oracle liveness to between 10 minutes and 100 years.
    uint256 public constant MINIMUM_LIVENESS = 10 minutes;
    uint256 public constant MAXIMUM_LIVENESS = 5200 weeks;

    // Final fee can be synced and stored in the contract.
    uint256 public finalFee;

    // Index of next created reward or proposal.
    uint256 public nextCreatedReward;
    uint256 public nextCreatedProposal;

    // Rewards and proposals are mapped to their indices.
    mapping(uint256 => Reward) public rewards;
    mapping(uint256 => Proposal) public proposals;

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
        bytes32 priceIdentifier,
        bytes customAncillaryData
    );
    event RewardIncreased(uint256 indexed rewardIndex, uint256 newMaximumRewardAmount);
    event ProposalCreated(
        address indexed sponsor,
        IERC20 rewardToken,
        uint256 indexed rewardIndex,
        uint256 indexed proposalIndex,
        uint256 proposalTimestamp,
        uint256 maximumRewardAmount,
        bytes32 merkleRoot,
        string ipfsHash
    );
    event RewardDistributed(
        address indexed sponsor,
        IERC20 rewardToken,
        uint256 indexed rewardIndex,
        uint256 indexed proposalIndex,
        uint256 maximumRewardAmount,
        bytes32 merkleRoot,
        string ipfsHash
    );
    event ProposalRejected(uint256 indexed rewardIndex, uint256 indexed proposalIndex);
    event ProposalDeleted(uint256 indexed rewardIndex, uint256 indexed proposalIndex);
    event MerkleDistributorSet(address indexed merkleDistributor);

    /**
     * @notice Constructor.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _finder Finder to look up UMA contract addresses.
     */
    constructor(FinderInterface _finder, IERC20 _bondToken) {
        finder = _finder;
        require(_getCollateralWhitelist().isOnWhitelist(address(_bondToken)), "Bond token not supported");
        bondToken = _bondToken;
        syncUmaEcosystemParams();
    }

    /********************************************
     *            FUNDING FUNCTIONS             *
     ********************************************/

    /**
     * @notice Allows any caller to create a rewards object and deposit tokens that are linked to these rewards.
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

        // Since proposalIndex has variable length as string, it is not appended here and is assumed
        // to be included in ANCILLARY_BYTES_RESERVE.
        require(
            optimisticOracle.stampAncillaryData(customAncillaryData, address(this)).length + ANCILLARY_BYTES_RESERVE <=
                optimisticOracle.ancillaryBytesLimit(),
            "Ancillary data too long"
        );
        require(optimisticOracleLivenessTime >= MINIMUM_LIVENESS, "OO liveness too small");
        require(optimisticOracleLivenessTime < MAXIMUM_LIVENESS, "OO liveness too large");

        // Pull maximum rewards from the sponsor.
        rewardToken.safeTransferFrom(msg.sender, address(this), maximumRewardAmount);

        // Store funded reward and log created reward.
        Reward memory reward =
            Reward({
                sponsor: msg.sender,
                rewardToken: rewardToken,
                maximumRewardAmount: maximumRewardAmount,
                earliestProposalTimestamp: earliestProposalTimestamp,
                optimisticOracleProposerBond: optimisticOracleProposerBond,
                optimisticOracleLivenessTime: optimisticOracleLivenessTime,
                priceIdentifier: priceIdentifier,
                customAncillaryData: customAncillaryData
            });
        uint256 rewardIndex = nextCreatedReward;
        rewards[rewardIndex] = reward;
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

        // Bump nextCreatedReward index.
        nextCreatedReward++;
    }

    /**
     * @notice Allows anyone to deposit additional rewards for distribution before `earliestProposalTimestamp`.
     * @dev The caller must approve this contract to transfer `additionalRewardAmount` amount of `rewardToken`.
     * @param rewardIndex Index for identifying existing rewards object that should receive additional funding.
     * @param additionalRewardAmount Additional reward amount that the sponsor is posting for distribution.
     */
    function increaseReward(uint256 rewardIndex, uint256 additionalRewardAmount) external nonReentrant() {
        require(rewards[rewardIndex].sponsor != address(0), "Invalid rewardIndex");
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
     * @dev The caller must approve this contract to transfer `optimisticOracleProposerBond` + final fee amount
     * of `bondToken`.
     * @param rewardIndex Index for identifying existing rewards object that should be proposed for distribution.
     * @param merkleRoot Merkle root describing allocation of proposed rewards distribution.
     * @param ipfsHash Hash of IPFS object, conveniently stored for clients to verify proposed distribution.
     */
    function proposeDistribution(
        uint256 rewardIndex,
        bytes32 merkleRoot,
        string calldata ipfsHash
    ) external nonReentrant() {
        Reward memory reward = rewards[rewardIndex];
        require(reward.sponsor != address(0), "Invalid rewardIndex");

        uint256 timestamp = getCurrentTime();
        require(timestamp >= reward.earliestProposalTimestamp, "No proposals in funding period");

        // Append proposal index to ancillary data.
        uint256 proposalIndex = nextCreatedProposal;
        bytes memory ancillaryData = _appendProposalIndex(proposalIndex, reward.customAncillaryData);

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
        proposals[proposalIndex] = Proposal({
            rewardIndex: rewardIndex,
            timestamp: timestamp,
            merkleRoot: merkleRoot,
            ipfsHash: ipfsHash
        });
        emit ProposalCreated(
            reward.sponsor,
            reward.rewardToken,
            rewardIndex,
            proposalIndex,
            timestamp,
            reward.maximumRewardAmount,
            merkleRoot,
            ipfsHash
        );

        // Bump nextCreatedProposal index.
        nextCreatedProposal++;
    }

    /**
     * @notice Allows any caller to execute distribution that has been validated by the Optimistic Oracle.
     * @param proposalIndex Index for identifying existing rewards distribution proposal.
     * @dev Calling this for unresolved proposals will revert. Both accepted and rejected distribution
     * proposals will be deleted from storage.
     */
    function executeDistribution(uint256 proposalIndex) external nonReentrant() {
        // All valid proposals should have non-zero proposal timestamp.
        Proposal memory proposal = proposals[proposalIndex];
        require(proposal.timestamp != 0, "Invalid proposalIndex");

        // Append proposal index to ancillary data.
        Reward memory reward = rewards[proposal.rewardIndex];
        bytes memory ancillaryData = _appendProposalIndex(proposalIndex, reward.customAncillaryData);

        // Get resolved price. Reverts if the request is not settled or settleable.
        int256 resolvedPrice =
            optimisticOracle.settleAndGetPrice(reward.priceIdentifier, proposal.timestamp, ancillaryData);

        // Transfer rewards to MerkleDistributor for accepted proposal.
        if (resolvedPrice == 1e18) {
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
                proposalIndex,
                reward.maximumRewardAmount,
                proposal.merkleRoot,
                proposal.ipfsHash
            );
        } else emit ProposalRejected(proposal.rewardIndex, proposalIndex);

        // Delete resolved proposal from storage. This also avoids double-spend for approved proposals.
        delete proposals[proposalIndex];
        emit ProposalDeleted(proposal.rewardIndex, proposalIndex);
    }

    /**
     * @notice Allows any caller to delete distribution that was rejected by the Optimistic Oracle.
     */
    function deleteRejectedDistribution(uint256 proposalIndex) external nonReentrant() {}

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
    }

    // Can be overriden for testing.
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
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

    function _appendProposalIndex(uint256 proposalIndex, bytes memory customAncillaryData)
        internal
        view
        returns (bytes memory)
    {
        return AncillaryData.appendKeyValueUint(customAncillaryData, "proposalIndex", proposalIndex);
    }
}
