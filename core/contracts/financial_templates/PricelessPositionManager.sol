pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../ExpandedIERC20.sol";
import "../FixedPoint.sol";
import "../Testable.sol";
import "./Token.sol";
import "../Finder.sol";
import "../OracleInterface.sol";
/**
 * @title Financial contract with priceless position management.
 * @dev Handles positions for multiple sponsors in an optimistic (i.e., priceless) way without relying on a price feed.
 * On construction, deploys a new ERC20 that this contract manages that is the synthetic token.
 */
//TODO: implement the AdministrateeInterface.sol interfaces and emergency shut down.
contract PricelessPositionManager is Testable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @dev Represents a single sponsor's position. All collateral is actually held by the Position contract as a whole,
     * and this struct is bookkeeping for how much of that collateral is allocated to this sponsor.
     */
    struct PositionData {
        bool isValid;
        FixedPoint.Unsigned collateral;
        FixedPoint.Unsigned tokensOutstanding;
        // Tracks pending withdrawal requests. A withdrawal request is pending if `requestPassTimestamp != 0`.
        uint requestPassTimestamp;
        FixedPoint.Unsigned withdrawalRequestAmount;
    }
    /**
     * @dev Maps sponsor addresses to their positions. Each sponsor can have only one position.
     */
    mapping(address => PositionData) public positions;

    // Keep track of the total collateral and tokens across all positions to enable calculating the global
    // collateralization ratio without iterating over all positions.
    FixedPoint.Unsigned public totalPositionCollateral;
    FixedPoint.Unsigned public totalTokensOutstanding;

    ExpandedIERC20 public tokenCurrency;
    IERC20 public collateralCurrency;

    // Finder knows the deployed addresses of all other smart contracts in UMA ecosystem.
    Finder public finder;

    // Unique identifier for DVM price feed ticker.
    bytes32 priceIdentifer;

    /**
     * @dev Time that this contract expires.
     */
    uint public expirationTimestamp;
    /**
     * @dev Time that has to elapse for a withdrawal request to be considered passed, if no liquidations occur.
     */
    uint public withdrawalLiveness;

    constructor(
        uint _expirationTimestamp,
        uint _withdrawalLiveness,
        address _collateralAddress,
        bool _isTest,
        address _finderAddress,
        bytes32 _priceFeedIdentifier
    ) public Testable(_isTest) {
        expirationTimestamp = _expirationTimestamp;
        withdrawalLiveness = _withdrawalLiveness;
        collateralCurrency = IERC20(_collateralAddress);
        //TODO: add parameters to register the synthetic token's name and symbol.
        //TODO: add the collateral requirement. This is needed at settlement and at dispute resolution.
        Token mintableToken = new Token();
        tokenCurrency = ExpandedIERC20(address(mintableToken));
        finder = Finder(_finderAddress);
        priceIdentifer = _priceFeedIdentifier;
    }

    modifier onlyPreExpiration() {
        require(getCurrentTime() < expirationTimestamp, "Cannot operate on a position past its expiry time");
        _;
    }

    modifier onlyPostExpiration() {
        require(getCurrentTime() >= expirationTimestamp, "Cannot operate on a position before its expiry time");
        _;
    }

    /**
     * @notice Transfers ownership of the caller's current position to `newSponsorAddress`. The address
     * `newSponsorAddress` isn't allowed to have a position of their own before the transfer.
     */
    function transfer(address newSponsorAddress) public onlyPreExpiration() {
        require(!positions[newSponsorAddress].isValid, "Cannot transfer to an address that already has a position");
        PositionData memory positionData = _getPositionData(msg.sender);
        positions[newSponsorAddress] = positionData;
        delete positions[msg.sender];
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` into the calling sponsor's position. Used to
     * increase the collateralization level of a position.
     */
    //TODO: should this check if the position is valid first?
    function deposit(FixedPoint.Unsigned memory collateralAmount) public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0, "Cannot deposit with a pending withdrawal request");
        positionData.collateral = positionData.collateral.add(collateralAmount);
        totalPositionCollateral = totalPositionCollateral.add(collateralAmount);
        require(collateralCurrency.transferFrom(msg.sender, address(this), collateralAmount.rawValue));
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` from the calling sponsor's position to the caller.
     * Reverts if the withdrawal puts this position's collateralization ratio below the global collateralization ratio.
     * In that case, use `requestWithdrawawal`.
     */
    function withdraw(FixedPoint.Unsigned memory collateralAmount) public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0, "Cannot withdraw with a pending withdrawal request");

        positionData.collateral = positionData.collateral.sub(collateralAmount);
        require(_checkCollateralizationRatio(positionData), "Cannot withdraw below global collateralization ratio");
        totalPositionCollateral = totalPositionCollateral.sub(collateralAmount);
        require(collateralCurrency.transfer(msg.sender, collateralAmount.rawValue));
    }

    /**
     * @notice After a passed withdrawal request (i.e., by a call to `requestWithdrawal` and waiting
     * `withdrawalLiveness`), withdraws `positionData.withdrawalRequestAmount` of collateral currency.
     */
    //TODO: should this check if the position is valid first?
    function withdrawPassedRequest() public onlyPreExpiration() {
        // TODO: Decide whether to fold this functionality into withdraw() method above.
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp < getCurrentTime(), "Cannot withdraw before request is passed");

        positionData.collateral = positionData.collateral.sub(positionData.withdrawalRequestAmount);
        totalPositionCollateral = totalPositionCollateral.sub(positionData.withdrawalRequestAmount);

        positionData.requestPassTimestamp = 0;
        require(collateralCurrency.transfer(msg.sender, positionData.withdrawalRequestAmount.rawValue));
    }

    /**
     * @notice Starts a withdrawal request that, if passed, allows the sponsor to withdraw `collateralAmount` from their
     * position. The request will be pending for `withdrawalLiveness`, during which the position can be liquidated.
     */
    //TODO: should this check if the position is valid first?
    //TODO: should this check if the contract is pre-expiration?
    function requestWithdrawal(FixedPoint.Unsigned memory collateralAmount) public {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0, "Cannot have concurrent withdrawal requests");

        // Not just pre-expiration: make sure the proposed expiration of this request is itself before expiry.
        uint requestPassTime = getCurrentTime() + withdrawalLiveness;
        require(
            requestPassTime < expirationTimestamp,
            "Cannot request withdrawal that would pass after contract expires"
        );

        // TODO: Handle case around downsizing a withdrawal request without resetting requestPassTime.
        positionData.requestPassTimestamp = requestPassTime;
        positionData.withdrawalRequestAmount = collateralAmount;
    }

    /**
     * @notice Cancels a pending withdrawal request.
     */
    function cancelWithdrawal() public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp != 0, "Cannot cancel if no pending withdrawal request");
        positionData.requestPassTimestamp = 0;
    }

    /**
     * @notice Pulls `collateralAmount` into the sponsor's position and mints `numTokens` of `tokenCurrency`. Reverts if
     * the minting these tokens would put the position's collateralization ratio below the global collateralization
     * ratio.
     */
    function create(FixedPoint.Unsigned memory collateralAmount, FixedPoint.Unsigned memory numTokens)
        public
        onlyPreExpiration()
    {
        PositionData storage positionData = positions[msg.sender];
        require(positionData.requestPassTimestamp == 0, "Cannot create with a pending withdrawal request");
        if (!positionData.isValid) {
            positionData.isValid = true;
        }
        positionData.collateral = positionData.collateral.add(collateralAmount);
        positionData.tokensOutstanding = positionData.tokensOutstanding.add(numTokens);
        require(_checkCollateralizationRatio(positionData), "Cannot create below global collateralization ratio");

        totalPositionCollateral = totalPositionCollateral.add(collateralAmount);
        totalTokensOutstanding = totalTokensOutstanding.add(numTokens);
        require(collateralCurrency.transferFrom(msg.sender, address(this), collateralAmount.rawValue));
        require(tokenCurrency.mint(msg.sender, numTokens.rawValue));
    }

    /**
     * @notice Burns `numTokens` of `tokenCurrency` and sends back the proportional amount of `collateralCurrency`.
     */
    //TODO: should this check if the position is valid first?
    function redeem(FixedPoint.Unsigned memory numTokens) public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0, "Cannot redeem with a pending withdrawal request");
        require(!numTokens.isGreaterThan(positionData.tokensOutstanding), "Can't redeem more than position size");

        FixedPoint.Unsigned memory fractionRedeemed = numTokens.div(positionData.tokensOutstanding);
        FixedPoint.Unsigned memory collateralRedeemed = fractionRedeemed.mul(positionData.collateral);

        positionData.collateral = positionData.collateral.sub(collateralRedeemed);
        totalPositionCollateral = totalPositionCollateral.sub(collateralRedeemed);
        // TODO: Need to wipe out the struct entirely on full redemption.
        positionData.tokensOutstanding = positionData.tokensOutstanding.sub(numTokens);
        totalTokensOutstanding = totalTokensOutstanding.sub(numTokens);

        require(collateralCurrency.transfer(msg.sender, collateralRedeemed.rawValue));
        // TODO: Use `burnFrom` here?
        require(tokenCurrency.transferFrom(msg.sender, address(this), numTokens.rawValue));
        tokenCurrency.burn(numTokens.rawValue);
    }

    /**
    * @notice After expiration of the contract the DVM is asked what for the prevailing price at the time of
    * expiration.
    */
    function expire() public onlyPostExpiration() {
        _requestOraclePrice(expirationTimestamp);
    }

    /**
     * @notice After a contract has passed maturity all token holders can redeem their tokens for underlying at
     * the prevailing price defined by the DVM from the `expire` function. This Burns all tokens from the caller
     * of `tokenCurrency` and sends back the proportional amount of `collateralCurrency`.
     */
    function settleExpired() public onlyPostExpiration() {
        // Get the current settlement price. If it is not resolved will revert.
        FixedPoint.Unsigned memory settlementPrice = _getOraclePrice(expirationTimestamp);

        // Get caller's tokens balance and calculate amount of underlying entitled to them.
        FixedPoint.Unsigned memory tokensToRedeem = FixedPoint.Unsigned(tokenCurrency.balanceOf(msg.sender));
        FixedPoint.Unsigned memory totalRedeemableCollateral = tokensToRedeem.div(settlementPrice);

        // TODO: what happens in the case where the position is invalid but the contract has expired; i.e they were
        // liquidated close to settlement and then contract settles before they withdraw.
        
        
        // If the caller is a sponsor they are also entitled to their underlying excess collateral.
        if (positions[msg.sender].isValid) {
            PositionData storage positionData = _getPositionData(msg.sender);

            // Calculate the underlying entitled to a token sponsor. This is collateral - debt in underlying.
            FixedPoint.Unsigned memory tokenDebtValueInCollateral = positionData.tokensOutstanding.div(settlementPrice);
            FixedPoint.Unsigned memory positionRedeemableCollateral = positionData.collateral.sub(
                tokenDebtValueInCollateral
            );

            // Add the number of redeemable tokens for the sponsor to their total redeemable collateral.
            totalRedeemableCollateral = totalRedeemableCollateral.add(positionRedeemableCollateral);

            // Reset the position state as all the value has been removed after settlement.
            positionData.collateral = FixedPoint.fromUnscaledUint(0);
            positionData.tokensOutstanding = FixedPoint.fromUnscaledUint(0);
        }

        // Transfer tokens and collateral.
        require(
            collateralCurrency.transfer(msg.sender, totalRedeemableCollateral.rawValue),
            "Collateral redemption send failed"
        );
        require(
            tokenCurrency.transferFrom(msg.sender, address(this), tokensToRedeem.rawValue),
            "Token redemption send failed"
        );
        tokenCurrency.burn(tokensToRedeem.rawValue);

        // Decrement total contract collateral and oustanding debt.
        totalPositionCollateral = totalPositionCollateral.sub(totalRedeemableCollateral);
        totalTokensOutstanding = totalTokensOutstanding.sub(tokensToRedeem);
    }

    function _getPositionData(address sponsor) internal view returns (PositionData storage position) {
        position = positions[sponsor];
        require(position.isValid, "Position does not exist");
    }

    function _requestOraclePrice(uint requestedTime) internal {
        OracleInterface oracle = OracleInterface(_getOracleAddress());
        oracle.requestPrice(priceIdentifer, requestedTime);
    }

    function _getOraclePrice(uint requestedTime) public view returns (FixedPoint.Unsigned memory) {
        // Create an instance of the oracle and get the price. If the price is not resolved revert.
        OracleInterface oracle = OracleInterface(_getOracleAddress());
        require(oracle.hasPrice(priceIdentifer, requestedTime), "Can only get a price once the DVM has resolved");
        int oraclePrice = oracle.getPrice(priceIdentifer, requestedTime);

        // For now we don't want to deal with negative prices in positions.
        if (oraclePrice < 0) {
            oraclePrice = 0;
        }
        return FixedPoint.fromUnscaledUint(_safeUintCast(oraclePrice));
    }

    function _getOracleAddress() internal view returns (address) {
        bytes32 oracleInterface = "Oracle";
        return finder.getImplementationAddress(oracleInterface);
    }

    function _getIdentifierWhitelistAddress() internal view returns (address) {
        bytes32 identifierWhitelistInterface = "IdentifierWhitelist";
        return finder.getImplementationAddress(identifierWhitelistInterface);
    }
    function _getStoreAddress() internal view returns (address) {
        bytes32 storeInterface = "Store";
        return finder.getImplementationAddress(storeInterface);
    }

    function _checkCollateralizationRatio(PositionData storage positionData) private view returns (bool) {
        FixedPoint.Unsigned memory global = _getCollateralizationRatio(totalPositionCollateral, totalTokensOutstanding);
        FixedPoint.Unsigned memory thisPos = _getCollateralizationRatio(
            positionData.collateral,
            positionData.tokensOutstanding
        );
        return !global.isGreaterThan(thisPos);
    }

    function _getCollateralizationRatio(FixedPoint.Unsigned storage collateral, FixedPoint.Unsigned storage numTokens)
        private
        view
        returns (FixedPoint.Unsigned memory ratio)
    {
        if (!numTokens.isGreaterThan(0)) {
            return FixedPoint.fromUnscaledUint(0);
        } else {
            return collateral.div(numTokens);
        }
    }

    function _safeUintCast(int value) private pure returns (uint result) {
        require(value >= 0);
        return uint(value);
    }
}
