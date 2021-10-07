// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../common/financial-product-libraries/long-short-pair-libraries/LongShortPairFinancialProductLibrary.sol";

import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";

import "../../common/interfaces/ExpandedIERC20.sol";

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

    /*************************************
     *  LONG SHORT PAIR DATA STRUCTURES  *
     *************************************/

    // Define the contract's constructor parameters as a struct to enable more variables to be specified.
    struct ConstructorParams {
        string pairName; // Name of the long short pair contract.
        uint64 expirationTimestamp; // Unix timestamp of when the contract will expire.
        uint256 collateralPerPair; // How many units of collateral are required to mint one pair of synthetic tokens.
        bytes32 priceIdentifier; // Price identifier, registered in the DVM for the long short pair.
        bool enableEarlyExpiration; // Enables the LPS contract to be settled early if the OO request is not disputed.
        ExpandedIERC20 longToken; // Token used as long in the LSP. Mint and burn rights needed by this contract.
        ExpandedIERC20 shortToken; // Token used as short in the LSP. Mint and burn rights needed by this contract.
        IERC20 collateralToken; // Collateral token used to back LSP synthetics.
        LongShortPairFinancialProductLibrary financialProductLibrary; // Contract providing settlement payout logic.
        bytes customAncillaryData; // Custom ancillary data to be passed along with the price request to the OO.
        uint256 prepaidProposerReward; // Preloaded reward to incentivize settlement price proposals.
        uint256 optimisticOracleLivenessTime; // OO liveness time for price requests.
        uint256 optimisticOracleProposerBond; // OO proposer bond for price requests.
        FinderInterface finder; // DVM finder to find other UMA ecosystem contracts.
        address timerAddress; // Timer used to synchronize contract time in testing. Set to 0x000... in production.
    }

    bool public receivedSettlementPrice;

    // Contract parametrization.
    uint64 public expirationTimestamp;
    uint64 public earlyExpirationTimestamp; // Set in the case the contract is expired early.
    string public pairName;
    uint256 public collateralPerPair; // Amount of collateral a pair of tokens is always redeemable for.

    // Number between 0 and 1e18 to allocate collateral between long & short tokens at redemption. 0 entitles each short
    // to collateralPerPair and long worth 0. 1e18 makes each long worth collateralPerPair and short 0.
    uint256 public expiryPercentLong;
    bytes32 public priceIdentifier;
    bool public enableEarlyExpiration; // If set, the LPS contract can request to be settled early by calling the OO.

    // Price returned from the Optimistic oracle at settlement time.
    int256 public expiryPrice;

    // External contract interfaces.
    IERC20 public collateralToken;
    ExpandedIERC20 public longToken;
    ExpandedIERC20 public shortToken;
    FinderInterface public finder;
    LongShortPairFinancialProductLibrary public financialProductLibrary;

    // Optimistic oracle customization parameters.
    bytes public customAncillaryData;
    uint256 public prepaidProposerReward;
    uint256 public optimisticOracleLivenessTime;
    uint256 public optimisticOracleProposerBond;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event TokensCreated(address indexed sponsor, uint256 indexed collateralUsed, uint256 indexed tokensMinted);
    event TokensRedeemed(address indexed sponsor, uint256 indexed collateralReturned, uint256 indexed tokensRedeemed);
    event ContractExpired(address indexed caller);
    event EarlyExpirationRequested(address indexed caller, uint64 earlyExpirationTimeStamp);
    event PositionSettled(address indexed sponsor, uint256 collateralReturned, uint256 longTokens, uint256 shortTokens);

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

    /**
     * @notice Construct the LongShortPair
     * @param params Constructor params used to initialize the LSP. Key-valued object with the following structure:
     *    - `pairName`: Name of the long short pair contract.
     *    - `expirationTimestamp`: Unix timestamp of when the contract will expire.
     *    - `collateralPerPair`: How many units of collateral are required to mint one pair of synthetic tokens.
     *    - `priceIdentifier`: Price identifier, registered in the DVM for the long short pair.
     *    - `longToken`: Token used as long in the LSP. Mint and burn rights needed by this contract.
     *    - `shortToken`: Token used as short in the LSP. Mint and burn rights needed by this contract.
     *    - `collateralToken`: Collateral token used to back LSP synthetics.
     *    - `financialProductLibrary`: Contract providing settlement payout logic.
     *    - `customAncillaryData`: Custom ancillary data to be passed along with the price request to the OO.
     *    - `prepaidProposerReward`: Preloaded reward to incentivize settlement price proposals.
     *    - `optimisticOracleLivenessTime`: OO liveness time for price requests.
     *    - `optimisticOracleProposerBond`: OO proposer bond for price requests.
     *    - `finder`: DVM finder to find other UMA ecosystem contracts.
     *    - `timerAddress`: Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(ConstructorParams memory params) Testable(params.timerAddress) {
        finder = params.finder;
        require(bytes(params.pairName).length > 0, "Pair name cant be empty");
        require(params.expirationTimestamp > getCurrentTime(), "Expiration timestamp in past");
        require(params.collateralPerPair > 0, "Collateral per pair cannot be 0");
        require(_getIdentifierWhitelist().isIdentifierSupported(params.priceIdentifier), "Identifier not registered");
        require(address(_getOptimisticOracle()) != address(0), "Invalid finder");
        require(address(params.financialProductLibrary) != address(0), "Invalid FinancialProductLibrary");
        require(_getCollateralWhitelist().isOnWhitelist(address(params.collateralToken)), "Collateral not whitelisted");
        require(params.optimisticOracleLivenessTime > 0, "OO liveness cannot be 0");
        require(params.optimisticOracleLivenessTime < 5200 weeks, "OO liveness too large");

        pairName = params.pairName;
        expirationTimestamp = params.expirationTimestamp;
        collateralPerPair = params.collateralPerPair;
        priceIdentifier = params.priceIdentifier;
        enableEarlyExpiration = params.enableEarlyExpiration;

        longToken = params.longToken;
        shortToken = params.shortToken;
        collateralToken = params.collateralToken;

        financialProductLibrary = params.financialProductLibrary;
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        require(
            optimisticOracle.stampAncillaryData(params.customAncillaryData, address(this)).length <=
                optimisticOracle.ancillaryBytesLimit(),
            "Ancillary Data too long"
        );

        customAncillaryData = params.customAncillaryData;
        prepaidProposerReward = params.prepaidProposerReward;
        optimisticOracleLivenessTime = params.optimisticOracleLivenessTime;
        optimisticOracleProposerBond = params.optimisticOracleProposerBond;
    }

    /****************************************
     *          POSITION FUNCTIONS          *
     ****************************************/

    /**
     * @notice Creates a pair of long and short tokens equal in number to tokensToCreate. Pulls the required collateral
     * amount into this contract, defined by the collateralPerPair value.
     * @dev The caller must approve this contract to transfer `tokensToCreate * collateralPerPair` amount of collateral.
     * @param tokensToCreate number of long and short synthetic tokens to create.
     * @return collateralUsed total collateral used to mint the synthetics.
     */
    function create(uint256 tokensToCreate) public preExpiration() nonReentrant() returns (uint256 collateralUsed) {
        // Note the use of mulCeil to prevent small collateralPerPair causing rounding of collateralUsed to 0 enabling
        // callers to mint dust LSP tokens without paying any collateral.
        collateralUsed = FixedPoint.Unsigned(tokensToCreate).mulCeil(FixedPoint.Unsigned(collateralPerPair)).rawValue;

        collateralToken.safeTransferFrom(msg.sender, address(this), collateralUsed);

        require(longToken.mint(msg.sender, tokensToCreate));
        require(shortToken.mint(msg.sender, tokensToCreate));

        emit TokensCreated(msg.sender, collateralUsed, tokensToCreate);
    }

    /**
     * @notice Redeems a pair of long and short tokens equal in number to tokensToRedeem. Returns the commensurate
     * amount of collateral to the caller for the pair of tokens, defined by the collateralPerPair value.
     * @dev This contract must have the `Burner` role for the `longToken` and `shortToken` in order to call `burnFrom`.
     * @dev The caller does not need to approve this contract to transfer any amount of `tokensToRedeem` since long
     * and short tokens are burned, rather than transferred, from the caller.
     * @dev This method can be called either pre or post expiration.
     * @param tokensToRedeem number of long and short synthetic tokens to redeem.
     * @return collateralReturned total collateral returned in exchange for the pair of synthetics.
     */
    function redeem(uint256 tokensToRedeem) public nonReentrant() returns (uint256 collateralReturned) {
        require(longToken.burnFrom(msg.sender, tokensToRedeem));
        require(shortToken.burnFrom(msg.sender, tokensToRedeem));

        collateralReturned = FixedPoint.Unsigned(tokensToRedeem).mul(FixedPoint.Unsigned(collateralPerPair)).rawValue;

        collateralToken.safeTransfer(msg.sender, collateralReturned);

        emit TokensRedeemed(msg.sender, collateralReturned, tokensToRedeem);
    }

    /**
     * @notice Settle long and/or short tokens in for collateral at a rate informed by the contract settlement.
     * @dev Uses financialProductLibrary to compute the redemption rate between long and short tokens.
     * @dev This contract must have the `Burner` role for the `longToken` and `shortToken` in order to call `burnFrom`.
     * @dev The caller does not need to approve this contract to transfer any amount of `tokensToRedeem` since long
     * and short tokens are burned, rather than transferred, from the caller.
     * @param longTokensToRedeem number of long tokens to settle.
     * @param shortTokensToRedeem number of short tokens to settle.
     * @return collateralReturned total collateral returned in exchange for the pair of synthetics.
     */
    function settle(uint256 longTokensToRedeem, uint256 shortTokensToRedeem)
        public
        nonReentrant()
        returns (uint256 collateralReturned)
    {
        require(
            getCurrentTime() > expirationTimestamp || // Past expiration time set in the constructor
                (getCurrentTime() < expirationTimestamp && enableEarlyExpiration), // before expiration time and early expiration enabled
            "Can not settle"
        );

        // Get the current settlement price and store it. If it is not resolved, will revert.
        if (!receivedSettlementPrice) getExpirationPrice();

        require(longToken.burnFrom(msg.sender, longTokensToRedeem));
        require(shortToken.burnFrom(msg.sender, shortTokensToRedeem));

        // expiryPercentLong is a number between 0 and 1e18. 0 means all collateral goes to short tokens and 1e18 means
        // all collateral goes to the long token. Total collateral returned is the sum of payouts.
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

    /**
     * @notice TODO
     * note on re guard
     */
    function requestEarlyExpiration(uint64 _earlyExpirationTimestamp) public nonReentrant() preExpiration() {
        require(enableEarlyExpiration, "Early expiration disabled");
        require(_earlyExpirationTimestamp <= getCurrentTime(), "Only propose expire in the past");
        require(!_isContractAlreadyEarlyExpired(), "Contract already early expire");

        earlyExpirationTimestamp = _earlyExpirationTimestamp;

        _requestOraclePriceExpiration(earlyExpirationTimestamp, getEarlyExpirationAncillaryData());

        emit EarlyExpirationRequested(msg.sender, _earlyExpirationTimestamp);
    }

    /**
     * @notice TODO
        // Note this method cant be called multiple times as the OO will revert if a price request is made multiple
        // times on the same identifier, timestamp & ancillary data combination.
     */
    function expire() public postExpiration() nonReentrant() {
        require(!_isContractAlreadyEarlyExpired(), "Contract already early expire");
        _requestOraclePriceExpiration(expirationTimestamp, customAncillaryData);

        emit ContractExpired(msg.sender);
    }

    /***********************************
     *      GLOBAL VIEW FUNCTIONS      *
     ***********************************/

    /**
     * @notice Returns the number of long and short tokens a sponsor wallet holds.
     * @param sponsor address of the sponsor to query.
     * @return longTokens the number of long tokens held by the sponsor.
     * @return shortTokens the number of short tokens held by the sponsor.
     */
    function getPositionTokens(address sponsor)
        public
        view
        nonReentrantView()
        returns (uint256 longTokens, uint256 shortTokens)
    {
        return (longToken.balanceOf(sponsor), shortToken.balanceOf(sponsor));
    }

    function getEarlyExpirationAncillaryData() public view returns (bytes memory) {
        return AncillaryData.appendKeyValueUint(customAncillaryData, "earlyExpiration", 1);
    }

    function oracleIgnoreEarlyExpirationPrice() public pure returns (int256) {
        return type(int256).min;
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // If the earlyExpirationTimestamp is != 0 then a previous early expiration OO request might still be in the
    // pending state. Check if the OO contains the ignore early price. If it does not contain this then the contract
    // was early expired correctly. Note that the _getOraclePrice call will revert if the price request is still pending.
    function _isContractAlreadyEarlyExpired() internal returns (bool) {
        return (earlyExpirationTimestamp != 0 &&
            _getOraclePrice(earlyExpirationTimestamp, getEarlyExpirationAncillaryData()) !=
            oracleIgnoreEarlyExpirationPrice());
    }

    function _getOraclePrice(uint64 requestTimestamp, bytes memory requestAncillaryData) internal returns (int256) {
        return _getOptimisticOracle().settleAndGetPrice(priceIdentifier, requestTimestamp, requestAncillaryData);
    }

    function _requestOraclePriceExpiration(uint256 requestTimestamp, bytes memory requestAncillaryData) internal {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        // Use the prepaidProposerReward as the proposer reward.
        if (prepaidProposerReward > 0) collateralToken.safeApprove(address(optimisticOracle), prepaidProposerReward);
        optimisticOracle.requestPrice(
            priceIdentifier,
            requestTimestamp,
            requestAncillaryData,
            collateralToken,
            prepaidProposerReward
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            priceIdentifier,
            requestTimestamp,
            requestAncillaryData,
            optimisticOracleLivenessTime
        );

        // Set the Optimistic oracle proposer bond for the price request.
        optimisticOracle.setBond(priceIdentifier, requestTimestamp, requestAncillaryData, optimisticOracleProposerBond);
    }

    function getExpirationPrice() internal {
        if (getCurrentTime() < expirationTimestamp) {
            expiryPrice = _getOraclePrice(earlyExpirationTimestamp, getEarlyExpirationAncillaryData());
            require(expiryPrice != oracleIgnoreEarlyExpirationPrice(), "Oracle prevents early expiration");
        } else {
            expiryPrice = _getOraclePrice(expirationTimestamp, customAncillaryData);
            // Cap the return value at 1.
            expiryPercentLong = Math.min(
                financialProductLibrary.percentageLongCollateralAtExpiry(expiryPrice),
                FixedPoint.fromUnscaledUint(1).rawValue
            );
        }
        receivedSettlementPrice = true;
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }
}
