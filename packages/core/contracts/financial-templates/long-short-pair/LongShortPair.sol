// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../common/financial-product-libraries/long-short-pair-libraries/LongShortPairFinancialProductLibrary.sol";

import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";

import "../../common/interfaces/ExpandedIERC20.sol";
import "../../common/interfaces/IERC20Standard.sol";

import "../../oracle/interfaces/OracleInterface.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/interfaces/OptimisticOracleInterface.sol";
import "../../oracle/interfaces/IdentifierWhitelistInterface.sol";

import "../../oracle/implementation/Constants.sol";

/**
 * @title Long Short Pair.
 * @notice Uses a combination of long and short tokens to tokenize the bounded price exposure to a given identifier.
 */

contract LongShortPair is Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    /*********************************************
     *  LONG SHORT PAIR DATA STRUCTURES  *
     *********************************************/

    enum ContractState { Open, ExpiredPriceRequested, ExpiredPriceReceived }
    ContractState public contractState;

    uint64 public expirationTimestamp;

    // Amount of collateral a pair of tokens is always redeemable for.
    uint256 public collateralPerPair;

    // Price returned from the Optimistic oracle at settlement time.
    int256 public expiryPrice;

    // number between 0 and 1e18 representing how much collateral long & short tokens are redeemable for. 0 makes each
    // short token worth collateralPerPair and long tokens worth 0. 1 makes each long token worth collateralPerPair and short 0.
    uint256 public expiryPercentLong;

    bytes32 public priceIdentifier;

    IERC20 public collateralToken;
    ExpandedIERC20 public longToken;
    ExpandedIERC20 public shortToken;

    FinderInterface public finder;

    LongShortPairFinancialProductLibrary public financialProductLibrary;

    bytes public customAncillaryData;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event TokensCreated(address indexed sponsor, uint256 indexed collateralUsed, uint256 indexed tokensMinted);
    event TokensRedeemed(address indexed sponsor, uint256 indexed collateralReturned, uint256 indexed tokensRedeemed);
    event ContractExpired(address indexed caller);
    event PositionSettled(
        address indexed sponsor,
        uint256 colllateralReturned,
        uint256 longTokens,
        uint256 shortTokens
    );

    /****************************************
     *               MODIFIERS              *
     ****************************************/

    modifier preExpiration() {
        require(getCurrentTime() < expirationTimestamp, "Only callable pre-expiry");
        _;
    }

    modifier postExpiration() {
        require(getCurrentTime() >= expirationTimestamp, "Only callable post-expiry");
        _;
    }

    modifier onlyOpenState() {
        require(contractState == ContractState.Open, "Contract state is not Open");
        _;
    }

    /**
     * @notice Construct the LongShortPair
     * @param _expirationTimestamp unix timestamp of when the contract will expire.
     * @param _collateralPerPair how many units of collateral are required to mint one pair of synthetic tokens.
     * @param _priceIdentifier registered in the DVM for the synthetic.
     * @param _longToken ERC20 token used as long in the LSP. Requires mint and burn needed by this contract.
     * @param _shortToken ERC20 token used as short in the LSP. Mint and burn rights needed by this contract.
     * @param _collateralToken ERC20 token used as collateral in the LSP.
     * @param _finder UMA protocol Finder used to discover other protocol contracts.
     * @param _financialProductLibrary Contract providing settlement payout logic.
     * @param _customAncillaryData Custom ancillary data to be passed along with the price request. If not needed, this
     *                             should be left as a 0-length bytes array.
     * @param _timerAddress Contract that stores the current time in a testing environment. Set to 0x0 in production.
     */
    constructor(
        uint64 _expirationTimestamp,
        uint256 _collateralPerPair,
        bytes32 _priceIdentifier,
        ExpandedIERC20 _longToken,
        ExpandedIERC20 _shortToken,
        IERC20 _collateralToken,
        FinderInterface _finder,
        LongShortPairFinancialProductLibrary _financialProductLibrary,
        bytes memory _customAncillaryData,
        address _timerAddress
    ) Testable(_timerAddress) {
        finder = _finder;
        require(_expirationTimestamp > getCurrentTime(), "Expiration timestamp in past");
        require(_getIdentifierWhitelist().isIdentifierSupported(_priceIdentifier), "Identifier not registered");
        require(address(_getOptimisticOracle()) != address(0), "Invalid finder");
        require(address(_financialProductLibrary) != address(0), "Invalid FinancialProductLibrary");
        require(_getAddressWhitelist().isOnWhitelist(address(_collateralToken)), "Collateral not whitelisted");

        expirationTimestamp = _expirationTimestamp;
        collateralPerPair = _collateralPerPair;
        priceIdentifier = _priceIdentifier;

        longToken = _longToken;
        shortToken = _shortToken;
        collateralToken = _collateralToken;

        financialProductLibrary = _financialProductLibrary;
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        require(
            optimisticOracle.stampAncillaryData(_customAncillaryData, address(this)).length <=
                optimisticOracle.ancillaryBytesLimit(),
            "Ancillary Data too long"
        );
        customAncillaryData = _customAncillaryData;
    }

    /****************************************
     *          POSITION FUNCTIONS          *
     ****************************************/

    /**
     * @notice Creates a pair of long and short tokens equal in number to tokensToCreate. Pulls the required collateral
     * amount into this contract, defined by the collateralPerPair value.
     * @param tokensToCreate number of long and short synthetic tokens to create.
     * @return collateralUsed total collateral used to mint the synthetics.
     */
    function create(uint256 tokensToCreate) public preExpiration() returns (uint256 collateralUsed) {
        collateralUsed = FixedPoint.Unsigned(tokensToCreate).mul(FixedPoint.Unsigned(collateralPerPair)).rawValue;

        collateralToken.safeTransferFrom(msg.sender, address(this), collateralUsed);

        longToken.mint(msg.sender, tokensToCreate);
        shortToken.mint(msg.sender, tokensToCreate);

        emit TokensCreated(msg.sender, collateralUsed, tokensToCreate);
    }

    /**
     * @notice Return a pair of long and short tokens equal in number to tokensToCreate. Returns the commensurate amount
     * of collateral to the caller for the pair of tokens, defined by the collateralPerPair value.
     * @param tokensToRedeem number of long and short synthetic tokens to redeem.
     * @return collateralReturned total collateral returned in exchange for the pair of synthetics.
     */
    function redeem(uint256 tokensToRedeem) public preExpiration() nonReentrant() returns (uint256 collateralReturned) {
        require(longToken.burnFrom(msg.sender, tokensToRedeem));
        require(shortToken.burnFrom(msg.sender, tokensToRedeem));

        collateralReturned = FixedPoint.Unsigned(tokensToRedeem).mul(FixedPoint.Unsigned(collateralPerPair)).rawValue;

        collateralToken.safeTransfer(msg.sender, collateralReturned);

        emit TokensRedeemed(msg.sender, collateralReturned, tokensToRedeem);
    }

    /**
     * @notice Settle long and/or short tokens in for collateral at a rate informed by the contract settlement.
     * @dev Uses financialProductLibrary to compute the redemption rate between long and short tokens.
     * @param longTokensToRedeem number of long tokens to settle.
     * @param shortTokensToRedeem number of short tokens to settle.
     * @param collateralReturned number of collateral tokens returned in exchange for long and short tokens.
     * @return collateralReturned total collateral returned in exchange for the pair of synthetics.
     */
    function settle(uint256 longTokensToRedeem, uint256 shortTokensToRedeem)
        public
        postExpiration()
        nonReentrant()
        returns (uint256 collateralReturned)
    {
        // If the contract state is open and postExpiration passed then `expire()` has not yet been called.
        require(contractState != ContractState.Open, "Unexpired contract");

        // Get the current settlement price and store it. If it is not resolved, will revert.
        if (contractState != ContractState.ExpiredPriceReceived) {
            expiryPrice = _getOraclePriceExpiration(expirationTimestamp);
            // Cap the return value at 1.
            expiryPercentLong = Math.min(
                financialProductLibrary.computeExpiryTokensForCollateral(expiryPrice),
                FixedPoint.fromUnscaledUint(1).rawValue
            );
            contractState = ContractState.ExpiredPriceReceived;
        }

        longToken.burnFrom(msg.sender, longTokensToRedeem);
        shortToken.burnFrom(msg.sender, shortTokensToRedeem);

        // expiryPercentLong is a number between 0 and 1e18. 0 means all collateral goes to short tokens and
        // 1 means all collateral goes to the long token. Total collateral returned is the sum of payouts.
        uint256 longCollateralRedeemed =
            FixedPoint
                .Unsigned(longTokensToRedeem)
                .mul(FixedPoint.Unsigned(collateralPerPair))
                .mul(FixedPoint.Unsigned(expiryPercentLong))
                .rawValue;
        uint256 shortCollateralRedeemed =
            FixedPoint
                .Unsigned(shortTokensToRedeem)
                .mul(FixedPoint.Unsigned(collateralPerPair))
                .mul(FixedPoint.fromUnscaledUint(1).sub(FixedPoint.Unsigned(expiryPercentLong)))
                .rawValue;

        collateralReturned = longCollateralRedeemed + shortCollateralRedeemed;
        collateralToken.safeTransfer(msg.sender, collateralReturned);

        emit PositionSettled(msg.sender, collateralReturned, longTokensToRedeem, shortTokensToRedeem);
    }

    /****************************************
     *        GLOBAL STATE FUNCTIONS        *
     ****************************************/

    function expire() public postExpiration() onlyOpenState() nonReentrant() {
        _requestOraclePriceExpiration();
        contractState = ContractState.ExpiredPriceRequested;

        emit ContractExpired(msg.sender);
    }

    /****************************************
     *      GLOBAL ACCESSORS FUNCTIONS      *
     ****************************************/
    /**
     * @notice Returns the number of long and short tokens a sponsor wallet holds.
     * @param sponsor address of the sponsor to query.
     * @return [uint256, uint256]. First is long tokens held by sponsor and second is short tokens held by sponsor.
     */
    function getPositionTokens(address sponsor) public view returns (uint256, uint256) {
        return (longToken.balanceOf(sponsor), shortToken.balanceOf(sponsor));
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    function _getOraclePriceExpiration(uint256 requestedTime) internal returns (int256) {
        // Create an instance of the oracle and get the price. If the price is not resolved revert.
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        require(optimisticOracle.hasPrice(address(this), priceIdentifier, requestedTime, customAncillaryData));
        int256 oraclePrice = optimisticOracle.settleAndGetPrice(priceIdentifier, requestedTime, customAncillaryData);

        return oraclePrice;
    }

    function _requestOraclePriceExpiration() internal {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        // For now, we add no fees the the OO and set the reward to 0.
        optimisticOracle.requestPrice(priceIdentifier, expirationTimestamp, customAncillaryData, collateralToken, 0);
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getAddressWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }
}
