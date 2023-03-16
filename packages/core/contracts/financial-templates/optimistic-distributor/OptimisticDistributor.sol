// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";
import "../../common/implementation/Testable.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";
import "../../merkle-distributor/implementation/MerkleDistributor.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../optimistic-oracle-v2/interfaces/OptimisticOracleV2Interface.sol";

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

    // Represents reward posted by a sponsor.
    struct Reward {
        bool distributionExecuted;
        address sponsor;
        IERC20 rewardToken;
        uint256 maximumRewardAmount;
        uint256 earliestProposalTimestamp;
        uint256 optimisticOracleProposerBond;
        uint256 optimisticOracleLivenessTime;
        uint256 previousProposalTimestamp;
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

    // Ancillary data length limit can be synced and stored in the contract.
    uint256 public ancillaryBytesLimit;

    // Rewards are stored in dynamic array.
    Reward[] public rewards;

    // Immutable variables used to validate input parameters when funding new rewards.
    uint256 public immutable maximumFundingPeriod;
    uint256 public immutable maximumProposerBond;

    // Proposals are mapped to hash of their identifier, timestamp and ancillaryData.
    mapping(bytes32 => Proposal) public proposals;

    // Immutable variables provided at deployment.
    FinderInterface public immutable finder;
    IERC20 public immutable bondToken;

    // Merkle Distributor is automatically deployed on constructor and owned by this contract.
    MerkleDistributor public immutable merkleDistributor;

    // Interface parameters that can be synced and stored in the contract.
    OptimisticOracleV2Interface public optimisticOracle;

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

    /**
     * @notice Constructor.
     * @param _finder Finder to look up UMA contract addresses.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _timer Contract that stores the current time in a testing environment.
     * @param _maximumFundingPeriod Maximum period for reward funding (proposals allowed only afterwards).
     * @param _maximumProposerBond Maximum allowed Optimistic Oracle proposer bond amount.
     */
    constructor(
        FinderInterface _finder,
        IERC20 _bondToken,
        address _timer,
        uint256 _maximumFundingPeriod,
        uint256 _maximumProposerBond
    ) Testable(_timer) {
        finder = _finder;
        require(_getCollateralWhitelist().isOnWhitelist(address(_bondToken)), "Bond token not supported");
        bondToken = _bondToken;
        syncUmaEcosystemParams();
        maximumFundingPeriod = _maximumFundingPeriod;
        maximumProposerBond = _maximumProposerBond;
        merkleDistributor = new MerkleDistributor();
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
        require(earliestProposalTimestamp <= getCurrentTime() + maximumFundingPeriod, "Too long till proposal opening");
        require(optimisticOracleProposerBond <= maximumProposerBond, "OO proposer bond too high");
        require(_getIdentifierWhitelist().isIdentifierSupported(priceIdentifier), "Identifier not registered");
        require(_ancillaryDataWithinLimits(customAncillaryData), "Ancillary data too long");
        require(optimisticOracleLivenessTime >= MINIMUM_LIVENESS, "OO liveness too small");
        require(optimisticOracleLivenessTime < MAXIMUM_LIVENESS, "OO liveness too large");

        // Store funded reward and log created reward.
        Reward memory reward =
            Reward({
                distributionExecuted: false,
                sponsor: msg.sender,
                rewardToken: rewardToken,
                maximumRewardAmount: maximumRewardAmount,
                earliestProposalTimestamp: earliestProposalTimestamp,
                optimisticOracleProposerBond: optimisticOracleProposerBond,
                optimisticOracleLivenessTime: optimisticOracleLivenessTime,
                previousProposalTimestamp: 0,
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

        // Pull maximum rewards from the sponsor.
        rewardToken.safeTransferFrom(msg.sender, address(this), maximumRewardAmount);
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

        // Update maximumRewardAmount and log new amount.
        rewards[rewardIndex].maximumRewardAmount += additionalRewardAmount;
        emit RewardIncreased(rewardIndex, rewards[rewardIndex].maximumRewardAmount);

        // Pull additional rewards from the sponsor.
        rewards[rewardIndex].rewardToken.safeTransferFrom(msg.sender, address(this), additionalRewardAmount);
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
        require(!reward.distributionExecuted, "Reward already distributed");
        require(_noBlockingProposal(rewardIndex, reward), "New proposals blocked");

        // Store current timestamp at reward struct so that any subsequent proposals are blocked till dispute.
        rewards[rewardIndex].previousProposalTimestamp = timestamp;

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
        require(!reward.distributionExecuted, "Reward already distributed");

        // Append reward index to ancillary data.
        bytes memory ancillaryData = _appendRewardIndex(proposal.rewardIndex, reward.customAncillaryData);

        // Get resolved price. Reverts if the request is not settled or settleable.
        int256 resolvedPrice =
            optimisticOracle.settleAndGetPrice(reward.priceIdentifier, proposal.timestamp, ancillaryData);

        // Transfer rewards to MerkleDistributor for accepted proposal and flag distributionExecuted.
        // This does not revert on rejected proposals so that disputer could receive back its bond and winning
        // in the same transaction when settleAndGetPrice is called above.
        if (resolvedPrice == 1e18) {
            rewards[proposal.rewardIndex].distributionExecuted = true;

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
        }
        // ProposalRejected can be emitted multiple times whenever someone tries to execute the same rejected proposal.
        else emit ProposalRejected(proposal.rewardIndex, proposalId);
    }

    /********************************************
     *          MAINTENANCE FUNCTIONS           *
     ********************************************/

    /**
     * @notice Updates the address stored in this contract for the OptimisticOracle to the latest version set
     * in the Finder.
     * @dev There is no risk of leaving this function public for anyone to call as in all cases we want the address of
     * OptimisticOracle in this contract to map to the latest version in the Finder.
     */
    function syncUmaEcosystemParams() public nonReentrant() {
        optimisticOracle = _getOptimisticOracle();
        ancillaryBytesLimit = optimisticOracle.ancillaryBytesLimit();
    }

    /********************************************
     *            INTERNAL FUNCTIONS            *
     ********************************************/

    function _getOptimisticOracle() internal view returns (OptimisticOracleV2Interface) {
        return OptimisticOracleV2Interface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV2));
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _appendRewardIndex(uint256 rewardIndex, bytes memory customAncillaryData)
        internal
        pure
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
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(identifier, timestamp, ancillaryData));
    }

    // Returns true if there are no blocking proposals (eiter there were no prior proposals or they were disputed).
    function _noBlockingProposal(uint256 rewardIndex, Reward memory reward) internal view returns (bool) {
        // Valid proposal cannot have zero timestamp.
        if (reward.previousProposalTimestamp == 0) return true;

        bytes memory ancillaryData = _appendRewardIndex(rewardIndex, reward.customAncillaryData);
        OptimisticOracleV2Interface.Request memory blockingRequest =
            optimisticOracle.getRequest(
                address(this),
                reward.priceIdentifier,
                reward.previousProposalTimestamp,
                ancillaryData
            );

        // Previous proposal is blocking till disputed that can be detected by non-zero disputer address.
        // In case Optimistic Oracle was upgraded since the previous proposal it needs to be unblocked for new proposal.
        // This can be detected by uninitialized bonding currency for the previous proposal.
        return blockingRequest.disputer != address(0) || address(blockingRequest.currency) == address(0);
    }
}
