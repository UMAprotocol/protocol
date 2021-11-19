// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/Testable.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/interfaces/StoreInterface.sol";
import "../../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../oracle/implementation/Constants.sol";
import "../../oracle/interfaces/SkinnyOptimisticOracleInterface.sol";
import "../../common/implementation/AncillaryData.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";
import "./OptimisticRewarderToken.sol";

/**
 * @notice The base rewarder contract. This manages depositing rewards and paying them out to tokenholders using values
 * backed by the OptimisticOracle's dispute process.
 */
abstract contract OptimisticRewarderBase is Lockable {
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
    uint256 public liveness;
    uint256 public bond;
    IERC20 public bondToken;
    bytes32 public identifier;
    bytes public customAncillaryData;

    // Mapping to track redemptions.
    mapping(bytes32 => Redemption) public redemptions;

    // Mapping to track the past total cumulative redemptions for tokenIds.
    mapping(uint256 => mapping(IERC20 => uint256)) public redeemedAmounts;

    // This allows other contracts to publish reward updates.
    event UpdateToken(uint256 indexed tokenId, address indexed caller, bytes data);

    event Deposited(address indexed depositor, IERC20 indexed token, uint256 amount);

    // Lifecycle events for redemptions.
    event Submitted(
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
        require(liveness > 0, "liveness == 0");
        liveness = _liveness;
        finder = _finder;
        require(_getCollateralWhitelist().isOnWhitelist(address(_bondToken)), "bond token not supported");
        bondToken = _bondToken;
        bond = _bond;
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "identifier not supported");
        identifier = _identifier;
        SkinnyOptimisticOracleInterface skinnyOptimisticOracle = _getOptimisticOracle();
        require(
            skinnyOptimisticOracle.stampAncillaryData(_customAncillaryData, address(this)).length <=
                skinnyOptimisticOracle.ancillaryBytesLimit(),
            "ancillary data too long"
        );
        customAncillaryData = _customAncillaryData;
    }

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
     * @dev if called by someone who doesn't own the token, they are effectively gifting their bond to the owner.
     * @param tokenId the tokenId the redemption is for.
     * @param cumulativeRedemptions the cumulative token addresses and amounts that this tokenId is eligible for
     * at the current timestap. cumulative redemptions that are too low should be considered to be valid.
     */
    function submitRedemption(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions) public nonReentrant {
        bytes32 redemptionId = _redemptionId(tokenId, cumulativeRedemptions);
        require(redemptions[redemptionId].expiryTime == 0, "Redemption already exists");
        require(ownerOf(tokenId) != address(0), "tokenId is invalid");

        uint256 time = getCurrentTime();

        uint256 finalFee = _getStore().computeFinalFee(address(bondToken)).rawValue;
        bondToken.safeTransferFrom(msg.sender, address(this), finalFee + bond);

        redemptions[redemptionId] = Redemption({ finalFee: finalFee, expiryTime: time + liveness });

        emit Submitted(tokenId, redemptionId, cumulativeRedemptions, time);
    }

    /**
     * @notice Disputes a redemption request.
     * @dev this will cancel a request if the final fee changes or something causes the optimistic oracle proposal to
     * fail.
     * @param tokenId the tokenId the redemption is for.
     * @param cumulativeRedemptions the cumulative redemptions that were provided in the original request.
     */
    function dispute(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions) public nonReentrant {
        bytes32 redemptionId = _redemptionId(tokenId, cumulativeRedemptions);

        // This automatically checks that redemptions[redemptionId] != 0.
        // Check that it has not passed liveness liveness.
        Redemption storage redemption = redemptions[redemptionId];
        require(getCurrentTime() < redemption.expiryTime, "redemption expired or nonexistent");
        if (redemption.finalFee != _getStore().computeFinalFee(address(bondToken)).rawValue) {
            _cancelRedemption(tokenId, redemptionId);
            return;
        } else {
            SkinnyOptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
            uint256 totalBond = bond + redemption.finalFee;
            bondToken.safeApprove(address(optimisticOracle), totalBond * 2);
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
                    // Reward = 0
                    0,
                    // Set the Optimistic oracle proposer bond for the price request.
                    bond,
                    // Set the Optimistic oracle liveness for the price request.
                    liveness,
                    proposer,
                    // Canonical value representing "True"; i.e. the proposed relay is valid.
                    int256(1e18)
                )
            returns (uint256) {} catch {
                _cancelRedemption(tokenId, redemptionId);
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
                    expirationTime: redemption.expiryTime,
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
        bytes32 redemptionId = _redemptionId(tokenId, cumulativeRedemptions);

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
            if (proposedRedemptionTotal > currentRedemptionTotal) {
                uint256 amountToPay = proposedRedemptionTotal - currentRedemptionTotal;
                redeemedAmounts[tokenId][token] = proposedRedemptionTotal;
                token.safeTransfer(msg.sender, amountToPay);
            }
        }

        // Return the bond to the owner.
        bondToken.safeTransfer(msg.sender, redemptions[redemptionId].expiryTime + bond);

        delete redemptions[redemptionId];

        emit Redeemed(tokenId, redemptionId, redemptions[redemptionId].expiryTime);
    }

    /**
     * @notice gets the current time. Can be overridden for testing.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    /**
     * @notice Abstract function that is called to mint the next ERC721 tokenId.
     * @param recipient the recipient of the newly minted token.
     */
    function mintNextToken(address recipient) public virtual returns (uint256);

    /**
     * @notice Abstract function that is called to check the owner of the token.
     * @dev this matches the ERC721 ownerOf interface.
     * @param tokenId the tokenId to check the owner of.
     */
    function ownerOf(uint256 tokenId) public view virtual returns (address);

    function _redemptionId(uint256 tokenId, RedemptionAmount[] memory amounts) internal pure returns (bytes32) {
        return keccak256(abi.encode(tokenId, amounts));
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
        Redemption storage redemption = redemptions[redemptionId];
        bondToken.safeTransfer(ownerOf(tokenId), redemption.finalFee + bond);
        emit Canceled(tokenId, redemptionId, redemption.expiryTime);
        delete redemptions[redemptionId];
    }
}

/**
 * @notice The common optimistic rewarder contract. It is both the contract that pays out the rewards and the ERC721
 * token itself.
 */
contract OptimisticRewarder is OptimisticRewarderBase, OptimisticRewarderToken {
    /**
     * @notice Constructor.
     * @param _name name for the ERC721 token.
     * @param _symbol symbol for the ERC721 token.
     * @param _baseUri prefix to each ERC721 tokenId's name.
     * @param _liveness liveness period between submission and verification of a reward.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _bond size of the bond.
     * @param _identifier identifier that should be passed to the optimistic oracle on dispute.
     * @param _customAncillaryData custom ancillary data that should be sent to the optimistic oracle on dispute.
     * @param _finder finder to look up UMA contract addresses.
     */
    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseUri,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData,
        FinderInterface _finder
    )
        OptimisticRewarderBase(_liveness, _bondToken, _bond, _identifier, _customAncillaryData, _finder)
        OptimisticRewarderToken(_name, _symbol, _baseUri)
    {}

    /**
     * @notice Used to mint the next ERC721 tokenId.
     * @param recipient the recipient of the newly minted token.
     */
    function mintNextToken(address recipient)
        public
        virtual
        override(OptimisticRewarderBase, OptimisticRewarderToken)
        returns (uint256)
    {
        return OptimisticRewarderToken.mintNextToken(recipient);
    }

    /**
     * @notice Used to check the owner of the token.
     * @dev this override is a formality required by solidity. It forwards the call to the internal ERC721
     * immplentation.
     * @param tokenId the tokenId to check the owner of.
     */
    function ownerOf(uint256 tokenId) public view virtual override(OptimisticRewarderBase, ERC721) returns (address) {
        return ERC721.ownerOf(tokenId);
    }
}

/**
 * @notice The optimistic rewarder that does not contain the ERC721 token. It allows the user to pass in an external
 * ERC721 token.
 * @dev this setup allows for graceful migrations to new rewarder contracts. It also allows external ERC721 tokens,
 * like uniswap v3 positions to be rewarded.
 */
contract OptimisticRewarderNoToken is OptimisticRewarderBase {
    OptimisticRewarderToken public token;

    /**
     * @notice Constructor.
     * @param _token external ERC721 token for the rewarder to base redemptions on.
     * @param _liveness liveness period between submission and verification of a reward.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _bond size of the bond.
     * @param _identifier identifier that should be passed to the optimistic oracle on dispute.
     * @param _customAncillaryData custom ancillary data that should be sent to the optimistic oracle on dispute.
     * @param _finder finder to look up UMA contract addresses.
     */
    constructor(
        OptimisticRewarderToken _token,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData,
        FinderInterface _finder
    ) OptimisticRewarderBase(_liveness, _bondToken, _bond, _identifier, _customAncillaryData, _finder) {
        token = _token;
    }

    /**
     * @notice Used to mint the next ERC721 tokenId.
     * @dev even if token contract does not support the `mintNextToken` function, this contract can still function
     * correctly assuming there is some other way to mint the ERC721 tokens. An issue in this method will only
     * affect the mint token in the base contract. Other methods will work fine.
     * @param recipient the recipient of the newly minted token.
     */
    function mintNextToken(address recipient) public virtual override returns (uint256) {
        return token.mintNextToken(recipient);
    }

    /**
     * @notice Used to check the owner of the token.
     * @dev this override forwards the call to the external token contract.
     * @param tokenId the tokenId to check the owner of.
     */
    function ownerOf(uint256 tokenId) public view virtual override returns (address) {
        return token.ownerOf(tokenId);
    }
}
