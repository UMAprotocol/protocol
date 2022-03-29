// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";
import "../../merkle-distributor/implementation/MerkleDistributor.sol";
import "../../oracle/implementation/Constants.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../oracle/interfaces/OptimisticOracleInterface.sol";
import "../../oracle/interfaces/StoreInterface.sol";

/**
 * @title  OptimisticDistributor contract.
 * @notice Allows sponsors to distribute rewards through MerkleDistributor contract secured by UMA Optimistic Oracle.
 */
abstract contract OptimisticDistributor is Lockable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /********************************************
     *  OPTIMISTIC DISTRIBUTOR DATA STRUCTURES  *
     ********************************************/

    // Represents reward posted by a sponsor.
    struct Reward {
        address sponsor;
        IERC20 rewardToken;
        uint256 maximumRewardAmount;
        uint256 proposalTimestamp;
        bytes32 priceIdentifier;
        bytes customAncillaryData;
        uint256 optimisticOracleProposerBond;
        uint256 optimisticOracleLivenessTime;
    }

    // Represents proposed rewards distribution.
    struct Proposal {
        uint256 rewardIndex;
        uint256 timestamp;
        bytes32 merkleRoot;
    }

    /********************************************
     *      INTERNAL VARIABLES AND STORAGE      *
     ********************************************/

    // Reserve for bytes appended to ancillary data (e.g. OracleSpoke) when resolving price from non-mainnet chains.
    uint256 private constant ANCILLARY_BYTES_RESERVE = 512;

    // Restrict Optimistic Oracle liveness to less than ~100 years.
    uint256 public constant LIVENESS_LIMIT = 5200 weeks;

    // Immutable variables provided at deployment.
    FinderInterface public immutable finder;
    IERC20 public bondToken; // This cannot be declared immutable as bondToken needs to be checked against whitelist.

    // Merkle Distributor can be set only once.
    MerkleDistributor public merkleDistributor;

    // Parameters that can be synced and stored in the contract.
    uint256 public finalFee;
    StoreInterface public store;
    OptimisticOracleInterface public optimisticOracle;

    // Rewards and proposals are mapped to their indices.
    mapping(uint256 => Reward) public rewards;
    mapping(uint256 => Proposal) public proposals;

    // Index of next created reward or proposal.
    uint256 public nextCreatedReward;
    uint256 public nextCreatedProposal;

    /********************************************
     *                  EVENTS                  *
     ********************************************/

    event MerkleDistributorSet(address merkleDistributor);

    /**
     * @notice Constructor.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _finder Finder to look up UMA contract addresses.
     */
    constructor(IERC20 _bondToken, FinderInterface _finder) {
        finder = _finder;
        require(_getCollateralWhitelist().isOnWhitelist(address(_bondToken)), "bond token not supported");
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
     * @param proposalTimestamp Starting timestamp when proposals for distribution can be made.
     * @param priceIdentifier Identifier that should be passed to the Optimistic Oracle on proposed distribution.
     * @param customAncillaryData Custom ancillary data that should be sent to the Optimistic Oracle on proposed
     * distribution.
     * @param optimisticOracleProposerBond Amount of bondToken that should be posted in addition to final fee
     * to the Optimistic Oracle on proposed distribution.
     * @param optimisticOracleLivenessTime Liveness period in seconds during which proposed distribution can be
     * disputed through Optimistic Oracle.
     */
    function createReward(
        IERC20 rewardToken,
        uint256 maximumRewardAmount,
        uint256 proposalTimestamp,
        bytes32 priceIdentifier,
        bytes calldata customAncillaryData,
        uint256 optimisticOracleProposerBond,
        uint256 optimisticOracleLivenessTime
    ) external nonReentrant() {
        require(_getIdentifierWhitelist().isIdentifierSupported(priceIdentifier), "Identifier not registered");
        require(
            optimisticOracle
                .stampAncillaryData(
                AncillaryData.appendKeyValueUint(customAncillaryData, "proposalIndex", 0),
                address(this)
            )
                .length +
                ANCILLARY_BYTES_RESERVE <=
                optimisticOracle.ancillaryBytesLimit(),
            "ancillary data too long"
        );
        require(optimisticOracleLivenessTime > 0, "OO liveness cannot be 0");
        require(optimisticOracleLivenessTime < LIVENESS_LIMIT, "OO liveness too large");

        // Pull maximum rewards from the sponsor.
        rewardToken.safeTransferFrom(msg.sender, address(this), maximumRewardAmount);

        // Store funded reward and bump nextCreatedReward index.
        rewards[nextCreatedReward] = Reward({
            sponsor: msg.sender,
            rewardToken: rewardToken,
            maximumRewardAmount: maximumRewardAmount,
            proposalTimestamp: proposalTimestamp,
            priceIdentifier: priceIdentifier,
            customAncillaryData: customAncillaryData,
            optimisticOracleProposerBond: optimisticOracleProposerBond,
            optimisticOracleLivenessTime: optimisticOracleLivenessTime
        });
        nextCreatedReward = nextCreatedReward.add(1);
    }

    /**
     * @notice Allows existing sponsor to deposit additional rewards for distribution before `proposalTimestamp`.
     * @dev The caller must approve this contract to transfer `additionalRewardAmount` amount of `rewardToken`.
     * @param rewardIndex Index for identifying existing rewards object that should receive additional funding.
     * @param additionalRewardAmount Additional reward amount that the sponsor is posting for distribution.
     */
    function increaseReward(uint256 rewardIndex, uint256 additionalRewardAmount) external virtual;

    /********************************************
     *          DISTRIBUTION FUNCTIONS          *
     ********************************************/

    /**
     * @notice Allows any caller to propose distribution for funded reward starting from `proposalTimestamp`.
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
    ) external virtual;

    /**
     * @notice Allows any caller to execute distribution that has been validated by the Optimistic Oracle.
     * @param proposalIndex Index for identifying existing rewards distribution proposal.
     */
    function executeDistribution(uint256 proposalIndex) external virtual;

    /**
     * @notice Allows any caller to delete distribution that was rejected by the Optimistic Oracle.
     */
    function deleteRejectedDistribution(uint256 proposalIndex) external virtual;

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
        require(address(merkleDistributor) == address(0), "merkleDistributor already set");
        require(_merkleDistributor.owner() == address(this), "merkleDistributor not owned");

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
}
