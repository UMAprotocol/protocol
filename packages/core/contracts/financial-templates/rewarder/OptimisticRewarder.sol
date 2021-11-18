// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/Testable.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/interfaces/StoreInterface.sol";
import "../../oracle/implementation/Constants.sol";
import "../../oracle/interfaces/SkinnyOptimisticOracleInterface.sol";
import "../../common/implementation/AncillaryData.sol";

contract OptimisticRewarder is ERC721, Lockable {
    using SafeERC20 for IERC20;

    struct RedemptionAmount {
        uint256 amount;
        IERC20 token;
    }

    struct Redemption {
        uint256 finalFee;
        uint256 expiryTime;
    }

    FinderInterface public finder;
    string public baseUri;
    uint256 public nextTokenId;
    uint256 public liveness;
    uint256 public bond;
    IERC20 public bondToken;
    bytes32 public identifier;
    mapping(bytes32 => Redemption) public redemptions;
    mapping(uint256 => mapping(IERC20 => uint256)) public redeemedAmounts;

    event UpdateToken(uint256 indexed tokenId, address indexed caller, bytes data);
    event Submitted(
        uint256 indexed tokenId,
        bytes32 indexed redemptionId,
        RedemptionAmount[] cumulativeRedemptions,
        uint256 expiryTime
    );
    event Canceled(uint256 indexed tokenId, bytes32 indexed redemptionId, uint256 expiryTime);
    event Disputed(uint256 indexed tokenId, bytes32 indexed redemptionId, uint256 expiryTime);
    event Redeemed(uint256 indexed tokenId, bytes32 indexed redemptionId, uint256 expiryTime);

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseUri,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        FinderInterface _finder
    ) ERC721(_name, _symbol) {
        baseUri = _baseUri;
        liveness = _liveness;
        finder = _finder;
        bondToken = _bondToken;
        bond = _bond;
        identifier = _identifier;
    }

    function depositRewards(uint256 amount, IERC20 token) public nonReentrant {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function mint(address receiver, bytes memory data) public nonReentrant returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(receiver, tokenId);
        emit UpdateToken(tokenId, msg.sender, data);
    }

    function updateToken(uint256 tokenId, bytes memory data) public nonReentrant {
        emit UpdateToken(tokenId, msg.sender, data);
    }

    function submitRedemption(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions) public nonReentrant {
        bytes32 redemptionId = _redemptionId(tokenId, cumulativeRedemptions);
        require(redemptions[redemptionId].expiryTime == 0);

        uint256 time = getCurrentTime();

        uint256 finalFee = _getStore().computeFinalFee(address(bondToken)).rawValue;
        bondToken.safeTransferFrom(msg.sender, address(this), finalFee + bond);

        redemptions[redemptionId] = Redemption({ finalFee: finalFee, expiryTime: time + liveness });

        emit Submitted(tokenId, redemptionId, cumulativeRedemptions, time);
    }

    function dispute(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions) public nonReentrant {
        bytes32 redemptionId = _redemptionId(tokenId, cumulativeRedemptions);

        // This automatically checks that redemptions[redemptionId] != 0.
        // Check that it has not passed liveness liveness.
        Redemption storage redemption = redemptions[redemptionId];
        require(getCurrentTime() < redemption.expiryTime);
        if (redemption.finalFee != _getStore().computeFinalFee(address(bondToken)).rawValue) {
            bondToken.transfer(ownerOf(tokenId), redemption.finalFee + bond);
            emit Canceled(tokenId, redemptionId, redemption.expiryTime);
        } else {
            SkinnyOptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
            uint256 totalBond = bond + redemption.finalFee;
            bondToken.safeApprove(address(optimisticOracle), totalBond * 2);
            bytes memory ancillaryData = AncillaryData.appendKeyValueBytes32("", "redemptionId", redemptionId);
            uint32 requestTimestamp = uint32(redemption.expiryTime - liveness);
            address proposer = ownerOf(tokenId);

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
            );

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

    function redeem(uint256 tokenId, RedemptionAmount[] memory cumulativeRedemptions) public nonReentrant {
        bytes32 redemptionId = _redemptionId(tokenId, cumulativeRedemptions);

        // Can only be redeemed by owner.
        require(msg.sender == ownerOf(tokenId));

        // Check that the redemption is initialized and that it passed liveness.
        require(redemptions[redemptionId].expiryTime != 0 && getCurrentTime() >= redemptions[redemptionId].expiryTime);

        for (uint256 i = 0; i < cumulativeRedemptions.length; i++) {
            IERC20 token = cumulativeRedemptions[i].token;
            uint256 amount = cumulativeRedemptions[i].amount - redeemedAmounts[tokenId][token];
            redeemedAmounts[tokenId][token] = cumulativeRedemptions[i].amount;
            token.safeTransfer(msg.sender, amount);
        }

        // Return the bond to the owner.
        bondToken.safeTransfer(msg.sender, redemptions[redemptionId].expiryTime + bond);

        delete redemptions[redemptionId];

        emit Redeemed(tokenId, redemptionId, redemptions[redemptionId].expiryTime);
    }

    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseUri;
    }

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
}
