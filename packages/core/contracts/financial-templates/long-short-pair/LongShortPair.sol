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
import "../../common/interfaces/AddressWhitelistInterface.sol";

import "../../data-verification-mechanism/interfaces/OracleInterface.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";

import "../../optimistic-oracle-v2/interfaces/OptimisticOracleV2Interface.sol";

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
        bool enableEarlyExpiration; // Enables the LSP contract to be settled early.
        ExpandedIERC20 longToken; // Token used as long in the LSP. Mint and burn rights needed by this contract.
        ExpandedIERC20 shortToken; // Token used as short in the LSP. Mint and burn rights needed by this contract.
        IERC20 collateralToken; // Collateral token used to back LSP synthetics.
        LongShortPairFinancialProductLibrary financialProductLibrary; // Contract providing settlement payout logic.
        bytes customAncillaryData; // Custom ancillary data to be passed along with the price request to the OO.
        uint256 proposerReward; // Optimistic oracle reward amount, pulled from the caller of the expire function.
        uint256 optimisticOracleLivenessTime; // OO liveness time for price requests.
        uint256 optimisticOracleProposerBond; // OO proposer bond for price requests.
        FinderInterface finder; // DVM finder to find other UMA ecosystem contracts.
        address timerAddress; // Timer used to synchronize contract time in testing. Set to 0x000... in production.
    }

    bool public receivedSettlementPrice;

    bool public enableEarlyExpiration; // If set, the LSP contract can request to be settled early by calling the OO.
    uint64 public expirationTimestamp;
    uint64 public earlyExpirationTimestamp; // Set in the case the contract is expired early.
    string public pairName;
    uint256 public collateralPerPair; // Amount of collateral a pair of tokens is always redeemable for.

    // Number between 0 and 1e18 to allocate collateral between long & short tokens at redemption. 0 entitles each short
    // to collateralPerPair and each long to 0. 1e18 makes each long worth collateralPerPair and short 0.
    uint256 public expiryPercentLong;
    bytes32 public priceIdentifier;

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
    uint256 public proposerReward;
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

    modifier notEarlyExpired() {
        require(!isContractEarlyExpired(), "Contract already early expired");
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
     *    - `proposerReward`: Preloaded reward to incentivize settlement price proposals.
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
        OptimisticOracleV2Interface optimisticOracle = _getOptimisticOracle();

        // Ancillary data + additional stamped information should be less than ancillary data limit. Consider early
        // expiration ancillary data, if enableEarlyExpiration is set.
        customAncillaryData = params.customAncillaryData;
        require(
            optimisticOracle
                .stampAncillaryData(
                (enableEarlyExpiration ? getEarlyExpirationAncillaryData() : customAncillaryData),
                address(this)
            )
                .length <= optimisticOracle.ancillaryBytesLimit(),
            "Ancillary Data too long"
        );

        proposerReward = params.proposerReward;
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
     * @dev This function can be called before or after expiration to facilitate early expiration. If a price has
     * not yet been resolved for either normal or early expiration yet then it will revert.
     * @param longTokensToRedeem number of long tokens to settle.
     * @param shortTokensToRedeem number of short tokens to settle.
     * @return collateralReturned total collateral returned in exchange for the pair of synthetics.
     */
    function settle(uint256 longTokensToRedeem, uint256 shortTokensToRedeem)
        public
        nonReentrant()
        returns (uint256 collateralReturned)
    {
        // Either early expiration is enabled and it's before the expiration time or it's after the expiration time.
        require(
            (enableEarlyExpiration && getCurrentTime() < expirationTimestamp) ||
                getCurrentTime() >= expirationTimestamp,
            "Cannot settle"
        );

        // Get the settlement price and store it. Also sets expiryPercentLong to inform settlement. Reverts if either:
        // a) the price request has not resolved (either a normal expiration call or early expiration call) or b) If the
        // the contract was attempted to be settled early but the price returned is the ignore oracle price.
        // Note that we use the bool receivedSettlementPrice over checking for price != 0 as 0 is a valid price.
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
     * @notice Enables the LSP to request early expiration. This initiates a price request to the optimistic oracle at
     * the provided timestamp with a modified version of the ancillary data that includes the key "earlyExpiration:1"
     * which signals to the OO that this is an early expiration request, rather than standard settlement.
     * @dev The caller must approve this contract to transfer `proposerReward` amount of collateral.
     * @dev Will revert if: a) the contract is already early expired, b) it is after the expiration timestamp, c)
     * early expiration is disabled for this contract, d) the proposed expiration timestamp is in the future.
     * e) an early expiration attempt has already been made (in pending state).
     * @param _earlyExpirationTimestamp timestamp at which the early expiration is proposed.
     */
    function requestEarlyExpiration(uint64 _earlyExpirationTimestamp)
        public
        nonReentrant()
        notEarlyExpired()
        preExpiration()
    {
        require(enableEarlyExpiration, "Early expiration disabled");
        require(_earlyExpirationTimestamp <= getCurrentTime(), "Only propose expire in the past");
        require(_earlyExpirationTimestamp > 0, "Early expiration can't be 0");

        earlyExpirationTimestamp = _earlyExpirationTimestamp;

        _requestOraclePrice(earlyExpirationTimestamp, getEarlyExpirationAncillaryData());

        emit EarlyExpirationRequested(msg.sender, _earlyExpirationTimestamp);
    }

    /**
     * @notice Expire the LSP contract. Makes a request to the optimistic oracle to inform the settlement price.
     * @dev The caller must approve this contract to transfer `proposerReward` amount of collateral.
     * @dev Will revert if: a) the contract is already early expired, b) it is before the expiration timestamp or c)
     * an expire call has already been made.
     */
    function expire() public nonReentrant() notEarlyExpired() postExpiration() {
        _requestOraclePrice(expirationTimestamp, customAncillaryData);

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

    /**
     * @notice Generates a modified ancillary data that indicates the contract is being expired early.
     */
    function getEarlyExpirationAncillaryData() public view returns (bytes memory) {
        return AncillaryData.appendKeyValueUint(customAncillaryData, "earlyExpiration", 1);
    }

    /**
     * @notice Defines a special number that, if returned during an attempted early expiration, will cause the contract
     * to do nothing and not expire. This enables the OO (and DVM voters in the case of a dispute) to choose to keep
     * the contract running, thereby denying the early settlement request.
     */
    function ignoreEarlyExpirationPrice() public pure returns (int256) {
        return type(int256).min;
    }

    /**
     * @notice If the earlyExpirationTimestamp is != 0 then a previous early expiration OO request might still be in the
     * pending state. Check if the OO contains the ignore early price. If it does not contain this then the contract
     * was early expired correctly. Note that _getOraclePrice call will revert if the price request is still pending,
     * thereby reverting all upstream calls pre-settlement of the early expiration price request.
     */
    function isContractEarlyExpired() public returns (bool) {
        return (earlyExpirationTimestamp != 0 &&
            _getOraclePrice(earlyExpirationTimestamp, getEarlyExpirationAncillaryData()) !=
            ignoreEarlyExpirationPrice());
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // Return the oracle price for a given request timestamp and ancillary data combo.
    function _getOraclePrice(uint64 requestTimestamp, bytes memory requestAncillaryData) internal returns (int256) {
        return _getOptimisticOracle().settleAndGetPrice(priceIdentifier, requestTimestamp, requestAncillaryData);
    }

    // Request a price in the optimistic oracle for a given request timestamp and ancillary data combo. Set the bonds
    // accordingly to the deployer's parameters. Will revert if re-requesting for a previously requested combo.
    function _requestOraclePrice(uint64 requestTimestamp, bytes memory requestAncillaryData) internal {
        OptimisticOracleV2Interface optimisticOracle = _getOptimisticOracle();

        // If the proposer reward was set then pull it from the caller of the function.
        if (proposerReward > 0) {
            collateralToken.safeTransferFrom(msg.sender, address(this), proposerReward);
            collateralToken.safeApprove(address(optimisticOracle), proposerReward);
        }
        optimisticOracle.requestPrice(
            priceIdentifier,
            uint256(requestTimestamp),
            requestAncillaryData,
            collateralToken,
            proposerReward
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            priceIdentifier,
            uint256(requestTimestamp),
            requestAncillaryData,
            optimisticOracleLivenessTime
        );

        // Set the Optimistic oracle proposer bond for the price request.
        optimisticOracle.setBond(
            priceIdentifier,
            uint256(requestTimestamp),
            requestAncillaryData,
            optimisticOracleProposerBond
        );
    }

    // Fetch the optimistic oracle expiration price. If the oracle has the price for the provided expiration timestamp
    // and customData combo then return this. Else, try fetch the price on the early expiration ancillary data. If
    // there is no price for either, revert. If the early expiration price is the ignore price will also revert.
    function getExpirationPrice() internal {
        if (_getOptimisticOracle().hasPrice(address(this), priceIdentifier, expirationTimestamp, customAncillaryData))
            expiryPrice = _getOraclePrice(expirationTimestamp, customAncillaryData);
        else {
            expiryPrice = _getOraclePrice(earlyExpirationTimestamp, getEarlyExpirationAncillaryData());
            require(expiryPrice != ignoreEarlyExpirationPrice(), "Oracle prevents early expiration");
        }

        // Finally, compute the value of expiryPercentLong based on the expiryPrice. Cap the return value at 1e18 as
        // this should, by definition, between 0 and 1e18.
        expiryPercentLong = Math.min(
            financialProductLibrary.percentageLongCollateralAtExpiry(expiryPrice),
            FixedPoint.fromUnscaledUint(1).rawValue
        );

        receivedSettlementPrice = true;
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleV2Interface) {
        return OptimisticOracleV2Interface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV2));
    }
}
