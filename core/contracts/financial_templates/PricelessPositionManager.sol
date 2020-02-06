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
import "./FeePayer.sol";

/**
 * @title Financial contract with priceless position management.
 * @dev Handles positions for multiple sponsors in an optimistic (i.e., priceless) way without relying on a price feed.
 * On construction, deploys a new ERC20 that this contract manages that is the synthetic token.
 */
// TODO: implement the AdministrateeInterface.sol interfaces and emergency shut down.
contract PricelessPositionManager is FeePayer {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @dev Represents a single sponsor's position. All collateral is actually held by the Position contract as a whole,
     * and this struct is bookkeeping for how much of that collateral is allocated to this sponsor.
     */
    struct PositionData {
        bool isValid;
        FixedPoint.Unsigned tokensOutstanding;
        // Tracks pending withdrawal requests. A withdrawal request is pending if `requestPassTimestamp != 0`.
        uint requestPassTimestamp;
        FixedPoint.Unsigned withdrawalRequestAmount;
        // Raw collateral value. This value should never be accessed directly -- always use _getCollateral().
        // To add or remove collateral, use _addCollateral() and _removeCollateral().
        FixedPoint.Unsigned rawCollateral;
    }

    // TODO: determine how we should adjust collateral when the user reads it out of the contract.
    /**
     * @dev Maps sponsor addresses to their positions. Each sponsor can have only one position.
     */
    mapping(address => PositionData) public positions;

    // Keep track of the total collateral and tokens across all positions to enable calculating the global
    // collateralization ratio without iterating over all positions.
    FixedPoint.Unsigned public totalPositionCollateral;
    FixedPoint.Unsigned public totalTokensOutstanding;

    ExpandedIERC20 public tokenCurrency;

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

    /**
     * @dev Percentage adjustment that must be applied to rawCollateral so it takes fees into account.
     *
     * To adjust rawCollateral to a user-readable collateral value:
     * `realCollateral = rawCollateral * positionFeeAdjustment`
     *
     * When adding or removing collateral, the following adjustment must be made:
     * `updatedRawCollateral = rawCollateral + (addedCollateral / positionFeeAdjustment)`
     */
    FixedPoint.Unsigned positionFeeAdjustment;

    constructor(
        uint _expirationTimestamp,
        uint _withdrawalLiveness,
        address _collateralAddress,
        bool _isTest,
        address _finderAddress,
        bytes32 _priceFeedIdentifier
    ) public FeePayer(_collateralAddress, _finderAddress, _isTest) {
        expirationTimestamp = _expirationTimestamp;
        withdrawalLiveness = _withdrawalLiveness;
        // TODO: add parameters to register the synthetic token's name and symbol.
        // TODO: add the collateral requirement. This is needed at settlement and at dispute resolution.
        // TODO: validate the input of the finder/price identifier inputs.
        Token mintableToken = new Token();
        tokenCurrency = ExpandedIERC20(address(mintableToken));
        priceIdentifer = _priceFeedIdentifier;
        positionFeeAdjustment = FixedPoint.fromUnscaledUint(1);
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
    // TODO: transfer should not work if there is a pending withdraw
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
    // TODO: should this check if the position is valid first?
    function deposit(FixedPoint.Unsigned memory collateralAmount) public onlyPreExpiration() fees() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0, "Cannot deposit with a pending withdrawal request");
        _addCollateral(positionData, collateralAmount);
        totalPositionCollateral = totalPositionCollateral.add(collateralAmount);
        require(collateralCurrency.transferFrom(msg.sender, address(this), collateralAmount.rawValue));
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` from the calling sponsor's position to the caller.
     * Reverts if the withdrawal puts this position's collateralization ratio below the global collateralization ratio.
     * In that case, use `requestWithdrawawal`.
     */
    function withdraw(FixedPoint.Unsigned memory collateralAmount) public onlyPreExpiration() fees() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0, "Cannot withdraw with a pending withdrawal request");

        _removeCollateral(positionData, collateralAmount);
        require(_checkCollateralizationRatio(positionData), "Cannot withdraw below global collateralization ratio");
        totalPositionCollateral = totalPositionCollateral.sub(collateralAmount);
        require(collateralCurrency.transfer(msg.sender, collateralAmount.rawValue));
    }

    /**
     * @notice After a passed withdrawal request (i.e., by a call to `requestWithdrawal` and waiting
     * `withdrawalLiveness`), withdraws `positionData.withdrawalRequestAmount` of collateral currency.
     */
    // TODO: should this check if the position is valid first?
    // TODO: should you be able to submit a withdraw without any collateral?
    function withdrawPassedRequest() public onlyPreExpiration() fees() {
        // TODO: Decide whether to fold this functionality into withdraw() method above.
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp < getCurrentTime(), "Cannot withdraw before request is passed");

        _removeCollateral(positionData, positionData.withdrawalRequestAmount);
        totalPositionCollateral = totalPositionCollateral.sub(positionData.withdrawalRequestAmount);

        positionData.requestPassTimestamp = 0;
        require(collateralCurrency.transfer(msg.sender, positionData.withdrawalRequestAmount.rawValue));
    }

    /**
     * @notice Starts a withdrawal request that, if passed, allows the sponsor to withdraw `collateralAmount` from their
     * position. The request will be pending for `withdrawalLiveness`, during which the position can be liquidated.
     */
    // TODO: should this check if the position is valid first?
    // TODO: should this check if the contract is pre-expiration?
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
        fees()
    {
        PositionData storage positionData = positions[msg.sender];
        require(positionData.requestPassTimestamp == 0, "Cannot create with a pending withdrawal request");
        if (!positionData.isValid) {
            positionData.isValid = true;
        }
        _addCollateral(positionData, collateralAmount);
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
    // TODO: should this check if the position is valid first?
    function redeem(FixedPoint.Unsigned memory numTokens) public onlyPreExpiration() fees() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0, "Cannot redeem with a pending withdrawal request");
        require(!numTokens.isGreaterThan(positionData.tokensOutstanding), "Can't redeem more than position size");

        FixedPoint.Unsigned memory fractionRedeemed = numTokens.div(positionData.tokensOutstanding);
        FixedPoint.Unsigned memory collateralRedeemed = fractionRedeemed.mul(_getCollateral(positionData));

        _removeCollateral(positionData, collateralRedeemed);
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
     * @dev This overrides pfc() so the PricelessPositionManager can report its profit from corruption.
     */

    function pfc() public view returns (FixedPoint.Unsigned memory) {
        return totalPositionCollateral;
    }

    /**
     * @dev This overrides payFees() so the PricelessPositionManager can update its internal bookkeeping to account for
     * the fees.
     */

    function payFees() public returns (FixedPoint.Unsigned memory totalPaid) {
        // Capture pfc upfront.
        FixedPoint.Unsigned memory initialPfc = pfc();

        // Send the fee payment.
        totalPaid = super.payFees();

        // Exit early if pfc == 0 to prevent divide by 0.
        // TODO(#884): replace this with a FixedPoint.equal().
        if (initialPfc.rawValue == 0) {
            return totalPaid;
        }

        // TODO(#873): add divCeil and mulCeil to make sure that all rounding favors the contract rather than the user.
        // Adjust internal variables below.
        // Compute fee percentage that was paid by the entire contract (fees / pfc).
        FixedPoint.Unsigned memory feePercentage = totalPaid.div(initialPfc);

        // Compute adjustment to be applied to the position collateral (1 - feePercentage).
        FixedPoint.Unsigned memory adjustment = FixedPoint.fromUnscaledUint(1).sub(feePercentage);

        // Apply fee percentage to adjust totalPositionCollateral and positionFeeAdjustment.
        totalPositionCollateral = totalPositionCollateral.mul(adjustment);
        positionFeeAdjustment = positionFeeAdjustment.mul(adjustment);
    }

    /**
     * @notice Accessor method for a sponsor's collateral.
     * @dev This is necessary because the struct returned by the positions() method shows rawCollateral, which isn't a
     * user-readable value.
     */
    function getCollateral(address sponsor) public view returns (FixedPoint.Unsigned memory) {
        return _getCollateral(_getPositionData(sponsor));
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
        FixedPoint.Unsigned memory totalRedeemableCollateral = tokensToRedeem.mul(settlementPrice);

        // TODO: what happens in the case where the position is invalid but the contract has expired; i.e they were
        // liquidated close to settlement and then contract settles before they withdraw.

        // If the caller is a sponsor they are also entitled to their underlying excess collateral.
        if (positions[msg.sender].isValid) {
            PositionData storage positionData = _getPositionData(msg.sender);

            // Calculate the underlying entitled to a token sponsor. This is collateral - debt in underlying.
            FixedPoint.Unsigned memory tokenDebtValueInCollateral = positionData.tokensOutstanding.mul(settlementPrice);
            FixedPoint.Unsigned memory positionRedeemableCollateral = _getCollateral(positionData).sub(
                tokenDebtValueInCollateral
            );

            // Add the number of redeemable tokens for the sponsor to their total redeemable collateral.
            totalRedeemableCollateral = totalRedeemableCollateral.add(positionRedeemableCollateral);

            // Reset the position state as all the value has been removed after settlement.
            delete positions[msg.sender];
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

    function _deleteSponsorPosition(address sponsor) internal {
        PositionData storage positionToLiquidate = _getPositionData(sponsor);

        // Remove the collateral and outstanding from the overall total position.
        totalPositionCollateral = totalPositionCollateral.sub(_getCollateral(positionToLiquidate));
        totalTokensOutstanding = totalTokensOutstanding.sub(positionToLiquidate.tokensOutstanding);

        // Reset the sponsors position to have zero outstanding and collateral.
        delete positions[sponsor];
    }

    function _getPositionData(address sponsor) internal view returns (PositionData storage position) {
        position = positions[sponsor];
        require(position.isValid, "Position does not exist");
    }

    function _getCollateral(PositionData storage positionData)
        internal
        view
        returns (FixedPoint.Unsigned memory collateral)
    {
        return positionData.rawCollateral.mul(positionFeeAdjustment);
    }

    function _removeCollateral(PositionData storage positionData, FixedPoint.Unsigned memory collateral) internal {
        FixedPoint.Unsigned memory adjustedCollateral = collateral.div(positionFeeAdjustment);
        positionData.rawCollateral = positionData.rawCollateral.sub(adjustedCollateral);
    }

    function _addCollateral(PositionData storage positionData, FixedPoint.Unsigned memory collateral) internal {
        FixedPoint.Unsigned memory adjustedCollateral = collateral.div(positionFeeAdjustment);
        positionData.rawCollateral = positionData.rawCollateral.add(adjustedCollateral);
    }

    function _getOracleAddress() internal view returns (address) {
        bytes32 oracleInterface = "Oracle";
        return finder.getImplementationAddress(oracleInterface);
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
        return FixedPoint.Unsigned(_safeUintCast(oraclePrice));
    }

    function _checkCollateralizationRatio(PositionData storage positionData) private view returns (bool) {
        FixedPoint.Unsigned memory global = _getCollateralizationRatio(totalPositionCollateral, totalTokensOutstanding);
        FixedPoint.Unsigned memory thisPos = _getCollateralizationRatio(
            _getCollateral(positionData),
            positionData.tokensOutstanding
        );
        return !global.isGreaterThan(thisPos);
    }

    function _getCollateralizationRatio(FixedPoint.Unsigned memory collateral, FixedPoint.Unsigned storage numTokens)
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
        require(value >= 0, "Uint underflow");
        return uint(value);
    }
}
