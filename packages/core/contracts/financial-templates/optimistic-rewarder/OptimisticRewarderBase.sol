// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";
import "../../data-verification-mechanism/interfaces/StoreInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";
import "../../optimistic-oracle-v2/interfaces/SkinnyOptimisticOracleInterface.sol";
import "../../common/implementation/AncillaryData.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";

/**
 * @notice The base rewarder contract. This manages depositing rewards and paying them out to token holders using values
 * backed by the OptimisticOracle's dispute process.
 */
abstract contract OptimisticRewarderBase is Lockable, MultiCaller {
    using SafeERC20 for IERC20;

    struct RedemptionAmount {
        uint256 amount;
        IERC20 token;
    }

    struct Redemption {
        uint256 finalFee;
        uint256 expiryTime;
    }

    // Constants.
    FinderInterface public finder;
    bytes public customAncillaryData;
    IERC20 public bondToken;
    bytes32 public identifier;

    // Note: setters are intentionally absent for these parameters. If a deployer intends to modify these parameters,
    // this contract suite offers a simple migration path where a new Rewarder is created and the existing ERC721 token
    // can be passed in and used as the reward token there as well. This would be minimally painful for users.
    uint256 public liveness;
    uint256 public bond;

    // Parameters that can be synced and stored in the contract.
    uint256 public finalFee;
    StoreInterface public store;
    SkinnyOptimisticOracleInterface public optimisticOracle;

    // Mapping to track redemptions.
    mapping(bytes32 => Redemption) public redemptions;

    // Mapping to track the past total cumulative redemptions for tokenIds.
    mapping(uint256 => mapping(IERC20 => uint256)) public redeemedAmounts;

    /****************************************
     *                EVENTS                *
     ****************************************/

    // This allows other contracts to publish reward updates.
    event UpdateToken(uint256 indexed tokenId, address indexed caller, bytes data);

    event Deposited(address indexed depositor, IERC20 indexed token, uint256 amount);

    // Lifecycle events for redemptions.
    event Requested(
        uint256 indexed tokenId,
        bytes32 indexed redemptionId,
        RedemptionAmount[] cumulativeRedemptions,
        uint256 expiryTime
    );
    event Canceled(uint256 indexed tokenId, bytes32 indexed redemptionId, uint256 expiryTime);
    event Disputed(uint256 indexed tokenId, bytes32 indexed redemptionId, uint256 expiryTime);
    event Redeemed(uint256 indexed tokenId, bytes32 indexed redemptionId, uint256 expiryTime);

    /**
     * @notice Constructor.
     * @param _liveness liveness period between submission and verification of a reward.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _bond size of the bond.
     * @param _identifier identifier that should be passed to the optimistic oracle on dispute.
     * @param _customAncillaryData custom ancillary data that should be sent to the optimistic oracle on dispute.
     * @param _finder finder to look up UMA contract addresses.
     */
    constructor(
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData,
        FinderInterface _finder
    ) {
        require(_liveness > 0, "liveness can't be 0");
        liveness = _liveness;
        finder = _finder;
        require(_getCollateralWhitelist().isOnWhitelist(address(_bondToken)), "bond token not supported");
        bondToken = _bondToken;
        bond = _bond;
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "identifier not supported");
        identifier = _identifier;
        SkinnyOptimisticOracleInterface skinnyOptimisticOracle = _getOptimisticOracle();
        require(
            skinnyOptimisticOracle
                .stampAncillaryData(
                AncillaryData.appendKeyValueBytes32(_customAncillaryData, "redemptionId", bytes32(0)),
                address(this)
            )
                .length <= skinnyOptimisticOracle.ancillaryBytesLimit(),
            "ancillary data too long"
        );
        customAncillaryData = _customAncillaryData;
        _sync();
    }

    /****************************************
     *       GLOBAL PUBLIC FUNCTIONS        *
     ****************************************/

    /**
     * @notice Allows anyone to deposit reward tokens into the contract. Presumably, this would be the deployer or
     * protocol that wishes to reward the users interacting with the system.
     * @dev Once tokens are deposited, they cannot be withdrawn without claiming a reward. If a deployer wants an
     * "escape hatch", they can create a special tokenId for this purpose.
     * @param token ERC20 token that is being deposited.
     * @param amount amount of rewards to deposit.
     */
    function depositRewards(IERC20 token, uint256 amount) public nonReentrant {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount);
    }

    /**
     * @notice Allows the caller to mint a token to the receiver and include a reward-relevant update event with it.
     * This is intended to be used when the user first interacts with a reward-granting protocol.
     * @dev if the user prefers to only mint a new token, they should call the mintNextToken function.
     * @param receiver user that will receive the newly minted token.
     * @param data arbitrary caller-generated data that will be associated with this update.
     * @return tokenId of the newly minted token.
     */
    function mint(address receiver, bytes memory data) public nonReentrant returns (uint256 tokenId) {
        tokenId = mintNextToken(receiver);
        emit UpdateToken(tokenId, msg.sender, data);
    }

    /**
     * @notice Applies a reward-relevant update to an existing token.
     * @param tokenId the existing tokenId that the update should be applied to.
     * @param data arbitrary caller-generated data that will be associated with this update.
     */
    function updateToken(uint256 tokenId, bytes memory data) public nonReentrant {
        emit UpdateToken(tokenId, msg.sender, data);
    }

    /**
     * @notice Requests a redemption for any tokenId. This can be called by anyone.
     * @dev If called by someone who doesn't own the token, they are effectively gifting their bond to the owner.
     * @param tokenId the tokenId the redemption is for.
     * @param cumulativeRedemptions the cumulative token addresses and amounts that this tokenId is eligible for
     * at the current timestamp. cumulative redemptions that are too low should be considered to be valid.
     * @return totalBond sum of finalFee and bond paid by the caller of this function.
     */
    function requestRedemption(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions)
        public
        nonReentrant
        returns (uint256 totalBond)
    {
        bytes32 redemptionId = getRedemptionId(tokenId, cumulativeRedemptions);
        require(redemptions[redemptionId].expiryTime == 0, "Redemption already exists");
        require(ownerOf(tokenId) != address(0), "tokenId is invalid");
        // Note: it's important to put _some_ limit on the length of data passed in here. Otherwise, it is possible to
        // create values that are so long that this transaction would fit within the block gas limit, but the dispute
        // transaction would not.
        require(cumulativeRedemptions.length <= 100, "too many token transfers");

        uint256 expiryTime = getCurrentTime() + liveness;

        totalBond = finalFee + bond;
        bondToken.safeTransferFrom(msg.sender, address(this), totalBond);

        redemptions[redemptionId] = Redemption({ finalFee: finalFee, expiryTime: expiryTime });

        emit Requested(tokenId, redemptionId, cumulativeRedemptions, expiryTime);
    }

    /**
     * @notice Disputes a redemption request.
     * @dev will cancel a request if the final fee changes or something causes the optimistic oracle proposal to fail.
     * @param tokenId the tokenId the redemption is for.
     * @param cumulativeRedemptions the cumulative redemptions that were provided in the original request.
     */
    function dispute(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions) public nonReentrant {
        bytes32 redemptionId = getRedemptionId(tokenId, cumulativeRedemptions);

        // This automatically checks that redemptions[redemptionId] != 0.
        // Check that it has not passed liveness.
        Redemption storage redemption = redemptions[redemptionId];
        uint256 currentTime = getCurrentTime();
        require(currentTime < redemption.expiryTime, "redemption expired or nonexistent");

        // Final fees don't match to those in the current store, which means the bond the initial caller provided was
        // incorrect. Cancel the request to allow the requester to resubmit with the correct params.
        // Note: we pull the store directly from the finder to avoid any issues with an outdated store causing the
        // final fee to appear to be correct, but actually be outdated due to the OptimisticOracle pulling from a
        // newer store deployment.
        if (redemption.finalFee != _getStore().computeFinalFee(address(bondToken)).rawValue) {
            _cancelRedemption(tokenId, redemptionId);
            return;
        } else {
            uint256 totalBond = bond + redemption.finalFee;
            bondToken.safeIncreaseAllowance(address(optimisticOracle), totalBond * 2);
            bytes memory ancillaryData =
                AncillaryData.appendKeyValueBytes32(customAncillaryData, "redemptionId", redemptionId);
            uint32 requestTimestamp = uint32(redemption.expiryTime - liveness);
            address proposer = ownerOf(tokenId);

            try
                optimisticOracle.requestAndProposePriceFor(
                    identifier,
                    requestTimestamp,
                    ancillaryData,
                    bondToken,
                    0, // Reward = 0
                    bond, // Bond (on top of the final fee) for the proposer and disputer.
                    liveness,
                    proposer,
                    int256(1e18) // Canonical value representing "True"; i.e. the proposed redemption is valid.
                )
            returns (uint256) {} catch {
                // There are various cases that can cause an OptimisticOracle proposal to fail. These are unlikely, but
                // this is intended as a worst-case fallback to avoid undisputable requests.
                // A few examples:
                // 1. The token ceases to be approved.
                // 2. The identifier ceases to be approved.
                // 3. The request has been submitted before (same identifier, timestap, ancillary data, and requester).
                //    This should be impossible for this contract.
                // 4. The money bond + final fee is larger than approved or in the contract's balance. This should also
                //    be impossible in this contract.
                _cancelRedemption(tokenId, redemptionId);
                bondToken.safeApprove(address(optimisticOracle), 0); // Reset allowance.
                return;
            }

            SkinnyOptimisticOracleInterface.Request memory request =
                SkinnyOptimisticOracleInterface.Request({
                    proposer: proposer,
                    disputer: address(0),
                    currency: bondToken,
                    settled: false,
                    proposedPrice: int256(1e18),
                    resolvedPrice: 0,
                    expirationTime: currentTime + liveness,
                    reward: 0,
                    finalFee: redemption.finalFee,
                    bond: bond,
                    customLiveness: liveness
                });

            // Note: don't pull funds until here to avoid any transfers that aren't needed.
            bondToken.safeTransferFrom(msg.sender, address(this), totalBond);

            // Dispute the request that we just sent.
            optimisticOracle.disputePriceFor(
                identifier,
                requestTimestamp,
                ancillaryData,
                request,
                msg.sender,
                address(this)
            );

            emit Disputed(tokenId, redemptionId, redemption.expiryTime);
        }

        delete redemptions[redemptionId];
    }

    /**
     * @notice Redeem a redemption request that has passed liveness.
     * @dev returns the bond that was paid with the initial proposal.
     * @param tokenId the tokenId the redemption is for.
     * @param cumulativeRedemptions the cumulative redemptions that were provided in the original request.
     */
    function redeem(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions) public nonReentrant {
        bytes32 redemptionId = getRedemptionId(tokenId, cumulativeRedemptions);

        // Can only be redeemed by owner.
        require(msg.sender == ownerOf(tokenId), "must be called by token owner");

        // Check that the redemption is initialized and that it passed liveness.
        require(
            redemptions[redemptionId].expiryTime != 0 && getCurrentTime() >= redemptions[redemptionId].expiryTime,
            "unexpired or nonexistent"
        );

        for (uint256 i = 0; i < cumulativeRedemptions.length; i++) {
            IERC20 token = cumulativeRedemptions[i].token;
            uint256 currentRedemptionTotal = redeemedAmounts[tokenId][token];
            uint256 proposedRedemptionTotal = cumulativeRedemptions[i].amount;

            // Only pay if the cumulative amount specified in the request is larger than the amount paid out already.
            // Note: disallow payments of the bond token even if it's in the approved request is passed to ensure
            // rewards don't interfere with bond bookkeeping. This is checked here rather than at the initiation of the
            // request to avoid the cost of looping over the array twice in the lifecycle.
            if (proposedRedemptionTotal > currentRedemptionTotal && token != bondToken) {
                uint256 amountToPay = proposedRedemptionTotal - currentRedemptionTotal;
                redeemedAmounts[tokenId][token] = proposedRedemptionTotal;
                token.safeTransfer(msg.sender, amountToPay);
            }
        }

        // Return the bond to the owner.
        bondToken.safeTransfer(msg.sender, bond + redemptions[redemptionId].finalFee);

        emit Redeemed(tokenId, redemptionId, redemptions[redemptionId].expiryTime);

        delete redemptions[redemptionId];
    }

    /**
     * @notice Syncs external addresses and parameters into the contract.
     * @dev These are stored rather than read on each run to avoid expensive external calls in the happy-path.
     */
    function sync() public nonReentrant {
        _sync();
    }

    /**
     * @notice gets the current time. Can be overridden for testing.
     * @return current block timestamp.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    /**
     * @notice Abstract function that is called to mint the next ERC721 tokenId.
     * @param recipient the recipient of the newly minted token.
     * @return index of the next minted token.
     */
    function mintNextToken(address recipient) public virtual returns (uint256);

    /**
     * @notice Abstract function that is called to check the owner of the token.
     * @dev this matches the ERC721 ownerOf interface.
     * @param tokenId the tokenId to check the owner of.
     * @return owner of a particular tokenId.
     */
    function ownerOf(uint256 tokenId) public view virtual returns (address);

    /**
     * @notice Generates a redemption id for the tokenId and the claim amounts.
     * @param tokenId the tokenId that the claim is for.
     * @param cumulativeRedemptions the cumulative redemptions that were provided in the request.
     * @return redemption id. This is a hash of the tokenId and the cumulative redemptions.
     */
    function getRedemptionId(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(tokenId, cumulativeRedemptions));
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    function _sync() internal {
        store = _getStore();
        finalFee = store.computeFinalFee(address(bondToken)).rawValue;
        optimisticOracle = _getOptimisticOracle();
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _getOptimisticOracle() internal view returns (SkinnyOptimisticOracleInterface) {
        return
            SkinnyOptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.SkinnyOptimisticOracle));
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _cancelRedemption(uint256 tokenId, bytes32 redemptionId) internal {
        // On cancellation, perform a sync to ensure the contract has the most up-to-date addresses and params.
        _sync();
        Redemption storage redemption = redemptions[redemptionId];
        bondToken.safeTransfer(ownerOf(tokenId), redemption.finalFee + bond);
        emit Canceled(tokenId, redemptionId, redemption.expiryTime);
        delete redemptions[redemptionId];
    }
}
