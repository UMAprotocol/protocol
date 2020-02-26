pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";
import "../../common/interfaces/ExpandedIERC20.sol";
import "../../oracle/interfaces/OracleInterface.sol";
import "../../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "./TokenFactory.sol";
import "./FeePayer.sol";


/**
 * @title Financial contract with priceless position management.
 * @notice Handles positions for multiple sponsors in an optimistic (i.e., priceless) way without relying on a price feed.
 * On construction, deploys a new ERC20 that this contract manages that is the synthetic token.
 */

// TODO: implement the AdministrateeInterface.sol interfaces and emergency shut down.
contract PricelessPositionManager is FeePayer {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;
    using SafeERC20 for ExpandedIERC20;

    // Represents a single sponsor's position. All collateral is actually held by the Position contract as a whole,
    // and this struct is bookkeeping for how much of that collateral is allocated to this sponsor.
    struct PositionData {
        FixedPoint.Unsigned tokensOutstanding;
        // Tracks pending withdrawal requests. A withdrawal request is pending if `requestPassTimestamp != 0`.
        uint requestPassTimestamp;
        FixedPoint.Unsigned withdrawalRequestAmount;
        // Raw collateral value. This value should never be accessed directly -- always use _getCollateral().
        // To add or remove collateral, use _addCollateral() and _removeCollateral().
        FixedPoint.Unsigned rawCollateral;
    }

    // TODO: determine how we should adjust collateral when the user reads it out of the contract.
    // Maps sponsor addresses to their positions. Each sponsor can have only one position.
    mapping(address => PositionData) public positions;

    // Keep track of the total collateral and tokens across all positions to enable calculating the global
    // collateralization ratio without iterating over all positions.
    FixedPoint.Unsigned public totalTokensOutstanding;

    // Note: similar to the rawCollateral in PositionData, this value should not be used directly -- _getCollateral(),
    // _addCollateral() and _removeCollateral() should be used to access and adjust.
    FixedPoint.Unsigned public rawTotalPositionCollateral;

    // Synthetic token created by this contract.
    ExpandedIERC20 public tokenCurrency;

    // Unique identifier for DVM price feed ticker.
    bytes32 public priceIdentifer;
    // Time that this contract expires.
    uint public expirationTimestamp;
    // Time that has to elapse for a withdrawal request to be considered passed, if no liquidations occur.
    uint public withdrawalLiveness;

    // Whether the contract has received an expiry price.
    bool public hasExpiryPrice;

    // The expiry price pulled from the DVM.
    FixedPoint.Unsigned public expiryPrice;

    event Transfer(address indexed oldSponsor, address indexed newSponsor);
    event Deposit(address indexed sponsor, uint indexed collateralAmount);
    event Withdrawal(address indexed sponsor, uint indexed collateralAmount);
    event RequestWithdrawal(address indexed sponsor, uint indexed collateralAmount);
    event RequestWithdrawalExecuted(address indexed sponsor, uint indexed collateralAmount);
    event RequestWithdrawalCanceled(address indexed sponsor, uint indexed collateralAmount);
    event PositionCreated(address indexed sponsor, uint indexed collateralAmount, uint indexed tokenAmount);
    event NewSponsor(address indexed sponsor);
    event Redeem(address indexed sponsor, uint indexed collateralAmount, uint indexed tokenAmount);
    event ContractExpired(address indexed caller);
    event SettleExpiredPosition(
        address indexed caller,
        uint indexed collateralAmountReturned,
        uint indexed tokensBurned
    );

    modifier onlyPreExpiration() {
        _isPreExpiration();
        _;
    }

    modifier onlyPostExpiration() {
        _isPostExpiration();
        _;
    }

    modifier onlyCollateralizedPosition(address sponsor) {
        _isCollateralizedPosition(sponsor);
        _;
    }

    constructor(
        bool _isTest,
        uint _expirationTimestamp,
        uint _withdrawalLiveness,
        address _collateralAddress,
        address _finderAddress,
        bytes32 _priceIdentifier,
        string memory _syntheticName,
        string memory _syntheticSymbol,
        address _tokenFactoryAddress
    ) public FeePayer(_collateralAddress, _finderAddress, _isTest) {
        expirationTimestamp = _expirationTimestamp;
        withdrawalLiveness = _withdrawalLiveness;
        TokenFactory tf = TokenFactory(_tokenFactoryAddress);
        tokenCurrency = tf.createToken(_syntheticName, _syntheticSymbol, 18);

        require(_getIdentifierWhitelist().isIdentifierSupported(_priceIdentifier));

        priceIdentifer = _priceIdentifier;
    }

    /**
     * @notice Transfers ownership of the caller's current position to `newSponsorAddress`. The address
     * `newSponsorAddress` isn't allowed to have a position of their own before the transfer.
     * @dev transfering positions can only occure if the recipiant does not already have a position.
     * @param newSponsorAddress is the address to which the position will be transfered.
     */
    function transfer(address newSponsorAddress) public onlyPreExpiration() onlyCollateralizedPosition(msg.sender) {
        require(_getCollateral(positions[newSponsorAddress].rawCollateral).isEqual(FixedPoint.fromUnscaledUint(0)));
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0);
        positions[newSponsorAddress] = positionData;
        delete positions[msg.sender];

        emit Transfer(msg.sender, newSponsorAddress);
        emit NewSponsor(newSponsorAddress);
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` into the calling sponsor's position. Used to
     * increase the collateralization level of a position.
     * @param collateralAmount represents the total amount of tokens to be sent to the position for the sponsor.
     */

    // TODO: should this check if the position is valid first?
    function deposit(FixedPoint.Unsigned memory collateralAmount) public onlyPreExpiration() fees() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0);
        _addCollateral(positionData.rawCollateral, collateralAmount);
        _addCollateral(rawTotalPositionCollateral, collateralAmount);

        // Move collateral currency from sender to contract.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), collateralAmount.rawValue);

        emit Deposit(msg.sender, collateralAmount.rawValue);
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` from the calling sponsor's position to the caller.
     * @dev Reverts if the withdrawal puts this position's collateralization ratio below the global collateralization ratio.
     * In that case, use `requestWithdrawawal`.
     * @param collateralAmount is the amount of collateral to withdraw
     */
    function withdraw(FixedPoint.Unsigned memory collateralAmount)
        public
        onlyPreExpiration()
        onlyCollateralizedPosition(msg.sender)
        fees()
    {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0);

        _removeCollateral(positionData.rawCollateral, collateralAmount);
        require(_checkCollateralizationRatio(positionData));
        _removeCollateral(rawTotalPositionCollateral, collateralAmount);

        // Move collateral currency from contract to sender.
        collateralCurrency.safeTransfer(msg.sender, collateralAmount.rawValue);

        emit Withdrawal(msg.sender, collateralAmount.rawValue);
    }

    /**
     * @notice Starts a withdrawal request that, if passed, allows the sponsor to withdraw `collateralAmount` from their
     * position. 
     @dev The request will be pending for `withdrawalLiveness`, during which the position can be liquidated.
     @param collateralAmount the amount of collateral requested to withdraw
     */

    function requestWithdrawal(FixedPoint.Unsigned memory collateralAmount)
        public
        onlyPreExpiration()
        onlyCollateralizedPosition(msg.sender)
    {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0);

        // Not just pre-expiration: make sure the proposed expiration of this request is itself before expiry.
        uint requestPassTime = getCurrentTime() + withdrawalLiveness;
        require(requestPassTime < expirationTimestamp);

        // Update the position object for the user.
        positionData.requestPassTimestamp = requestPassTime;
        positionData.withdrawalRequestAmount = collateralAmount;

        emit RequestWithdrawal(msg.sender, collateralAmount.rawValue);
    }

    /**
     * @notice After a passed withdrawal request (i.e., by a call to `requestWithdrawal` and waiting
     * `withdrawalLiveness`), withdraws `positionData.withdrawalRequestAmount` of collateral currency.
     */
    // TODO: is onlyCollateralizedPosition(msg.sender) correct here? if a position withdraws all their collateral will this still work?
    // TODO: this currently does not decrement the sponsors oustanding withdrawalRequestAmount. should it?
    // TODO: Decide whether to fold this functionality into withdraw() method above.
    function withdrawPassedRequest() external onlyPreExpiration() onlyCollateralizedPosition(msg.sender) fees() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp < getCurrentTime());

        _removeCollateral(positionData.rawCollateral, positionData.withdrawalRequestAmount);
        _removeCollateral(rawTotalPositionCollateral, positionData.withdrawalRequestAmount);

        positionData.requestPassTimestamp = 0;

        // Transfer approved withdrawal amount from the contract to the caller.
        collateralCurrency.safeTransfer(msg.sender, positionData.withdrawalRequestAmount.rawValue);

        emit RequestWithdrawalExecuted(msg.sender, positionData.withdrawalRequestAmount.rawValue);
    }

    /**
     * @notice Cancels a pending withdrawal request.
     */
    function cancelWithdrawal() external onlyPreExpiration() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp != 0);

        emit RequestWithdrawalCanceled(msg.sender, positionData.withdrawalRequestAmount.rawValue);

        // Set withdrawal counters to zero
        positionData.requestPassTimestamp = 0;
        positionData.withdrawalRequestAmount = FixedPoint.fromUnscaledUint(0);
    }

    /**
     * @notice Pulls `collateralAmount` into the sponsor's position and mints `numTokens` of `tokenCurrency`. 
     * @dev Reverts if the minting these tokens would put the position's collateralization ratio below the
     * global collateralization ratio.
     * @param collateralAmount is the number of collateral tokens to collateralize the position with
     * @param numTokens is the number of tokens to mint from the position.
     */
    function create(FixedPoint.Unsigned memory collateralAmount, FixedPoint.Unsigned memory numTokens)
        public
        onlyPreExpiration()
        fees()
    {
        PositionData storage positionData = positions[msg.sender];
        require(positionData.requestPassTimestamp == 0);
        if (positionData.tokensOutstanding.isEqual(0)) {
            emit NewSponsor(msg.sender);
        }
        _addCollateral(positionData.rawCollateral, collateralAmount);
        positionData.tokensOutstanding = positionData.tokensOutstanding.add(numTokens);
        require(_checkCollateralizationRatio(positionData));

        _addCollateral(rawTotalPositionCollateral, collateralAmount);
        totalTokensOutstanding = totalTokensOutstanding.add(numTokens);

        // Transfer tokens into the contract from caller and mint the caller synthetic tokens.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), collateralAmount.rawValue);
        require(tokenCurrency.mint(msg.sender, numTokens.rawValue), "Minting synthetic tokens failed");

        emit PositionCreated(msg.sender, collateralAmount.rawValue, numTokens.rawValue);
    }

    /**
     * @notice Burns `numTokens` of `tokenCurrency` and sends back the proportional amount of `collateralCurrency`.
     */
    function redeem(FixedPoint.Unsigned memory numTokens)
        public
        onlyPreExpiration()
        onlyCollateralizedPosition(msg.sender)
        fees()
    {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.requestPassTimestamp == 0);
        require(!numTokens.isGreaterThan(positionData.tokensOutstanding));

        FixedPoint.Unsigned memory fractionRedeemed = numTokens.div(positionData.tokensOutstanding);
        FixedPoint.Unsigned memory collateralRedeemed = fractionRedeemed.mul(
            _getCollateral(positionData.rawCollateral)
        );

        // If redemption returns all tokens the sponsor has then we can delete their position. Else, downsize.
        if (positionData.tokensOutstanding.isEqual(numTokens)) {
            _deleteSponsorPosition(msg.sender);
        } else {
            // Decrease the sponsors position size of collateral and tokens.
            _removeCollateral(positionData.rawCollateral, collateralRedeemed);
            positionData.tokensOutstanding = positionData.tokensOutstanding.sub(numTokens);

            // Decrease the contract's collateral and tokens.
            _removeCollateral(rawTotalPositionCollateral, collateralRedeemed);
            totalTokensOutstanding = totalTokensOutstanding.sub(numTokens);
        }

        // Transfer collateral from contract to caller and burn callers synthetic tokens.
        collateralCurrency.safeTransfer(msg.sender, collateralRedeemed.rawValue);
        tokenCurrency.safeTransferFrom(msg.sender, address(this), numTokens.rawValue);
        tokenCurrency.burn(numTokens.rawValue);

        emit Redeem(msg.sender, collateralRedeemed.rawValue, numTokens.rawValue);
    }

    /**
     * @notice After expiration of the contract the DVM is asked what for the prevailing price at the time of
     * expiration. In addition, pay the final fee at this time. Once this has been resolved token holders can withdraw.
     */
    function expire() external onlyPostExpiration() fees() {
        // The final fee for this request is paid out of the contract rather than by the caller.
        _payFinalFees(address(this));
        _requestOraclePrice(expirationTimestamp);

        emit ContractExpired(msg.sender);
    }

    /**
     * @notice After a contract has passed maturity all token holders can redeem their tokens for underlying at
     * the prevailing price defined by the DVM from the `expire` function. 
     * @dev This Burns all tokens from the caller of `tokenCurrency` and sends back the proportional amount of `collateralCurrency`.
     */
    function settleExpired() external onlyPostExpiration() fees() {
        // Get the current settlement price and store it. If it is not resolved will revert.
        if (!hasExpiryPrice) {
            expiryPrice = _getOraclePrice(expirationTimestamp);
            hasExpiryPrice = true;
        }

        // Get caller's tokens balance and calculate amount of underlying entitled to them.
        FixedPoint.Unsigned memory tokensToRedeem = FixedPoint.Unsigned(tokenCurrency.balanceOf(msg.sender));
        FixedPoint.Unsigned memory totalRedeemableCollateral = tokensToRedeem.mul(expiryPrice);

        // If the caller is a sponsor with outstanding collateral they are also entitled to their excess collateral after their debt.
        PositionData storage positionData = positions[msg.sender];
        if (_getCollateral(positionData.rawCollateral).isGreaterThan(0)) {
            // Calculate the underlying entitled to a token sponsor. This is collateral - debt in underlying.
            FixedPoint.Unsigned memory tokenDebtValueInCollateral = positionData.tokensOutstanding.mul(expiryPrice);
            FixedPoint.Unsigned memory positionRedeemableCollateral = _getCollateral(positionData.rawCollateral).sub(
                tokenDebtValueInCollateral
            );

            // Add the number of redeemable tokens for the sponsor to their total redeemable collateral.
            totalRedeemableCollateral = totalRedeemableCollateral.add(positionRedeemableCollateral);

            // Reset the position state as all the value has been removed after settlement.
            delete positions[msg.sender];
        }

        // Transfer tokens & collateral and burn the redeemed tokens.
        collateralCurrency.safeTransfer(msg.sender, totalRedeemableCollateral.rawValue);
        tokenCurrency.safeTransferFrom(msg.sender, address(this), tokensToRedeem.rawValue);
        tokenCurrency.burn(tokensToRedeem.rawValue);

        // Decrement total contract collateral and oustanding debt.
        _removeCollateral(rawTotalPositionCollateral, totalRedeemableCollateral);
        totalTokensOutstanding = totalTokensOutstanding.sub(tokensToRedeem);

        emit SettleExpiredPosition(msg.sender, totalRedeemableCollateral.rawValue, tokensToRedeem.rawValue);
    }

    /**
     * @notice Accessor method for a sponsor's collateral.
     * @dev This is necessary because the struct returned by the positions() method shows rawCollateral, which isn't a
     * user-readable value.
     */
    function getCollateral(address sponsor) external view returns (FixedPoint.Unsigned memory) {
        // Note: do a direct access to avoid the validity check.
        return _getCollateral(positions[sponsor].rawCollateral);
    }

    function totalPositionCollateral() external view returns (FixedPoint.Unsigned memory) {
        return _getCollateral(rawTotalPositionCollateral);
    }

    /**
     * @dev This overrides pfc() so the PricelessPositionManager can report its profit from corruption.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function pfc() public virtual override view returns (FixedPoint.Unsigned memory) {
        return _getCollateral(rawTotalPositionCollateral);
    }

    function _deleteSponsorPosition(address sponsor) internal {
        PositionData storage positionToLiquidate = _getPositionData(sponsor);

        // Remove the collateral and outstanding from the overall total position.
        rawTotalPositionCollateral = rawTotalPositionCollateral.sub(positionToLiquidate.rawCollateral);
        totalTokensOutstanding = totalTokensOutstanding.sub(positionToLiquidate.tokensOutstanding);

        // Reset the sponsors position to have zero outstanding and collateral.
        delete positions[sponsor];
    }

    function _getPositionData(address sponsor)
        internal
        view
        onlyCollateralizedPosition(sponsor)
        returns (PositionData storage)
    {
        return positions[sponsor];
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        bytes32 identifierWhitelistInterface = "IdentifierWhitelist";
        return IdentifierWhitelistInterface(finder.getImplementationAddress(identifierWhitelistInterface));
    }

    function _getOracle() internal view returns (OracleInterface) {
        bytes32 oracleInterface = "Oracle";
        return OracleInterface(finder.getImplementationAddress(oracleInterface));
    }

    function _requestOraclePrice(uint requestedTime) internal {
        OracleInterface oracle = _getOracle();
        oracle.requestPrice(priceIdentifer, requestedTime);
    }

    function _getOraclePrice(uint requestedTime) internal view returns (FixedPoint.Unsigned memory) {
        // Create an instance of the oracle and get the price. If the price is not resolved revert.
        OracleInterface oracle = _getOracle();
        require(oracle.hasPrice(priceIdentifer, requestedTime), "Can only get a price once the DVM has resolved");
        int oraclePrice = oracle.getPrice(priceIdentifer, requestedTime);

        // For now we don't want to deal with negative prices in positions.
        if (oraclePrice < 0) {
            oraclePrice = 0;
        }
        return FixedPoint.Unsigned(_safeUintCast(oraclePrice));
    }

    function _checkCollateralizationRatio(PositionData storage positionData) private view returns (bool) {
        FixedPoint.Unsigned memory global = _getCollateralizationRatio(
            _getCollateral(rawTotalPositionCollateral),
            totalTokensOutstanding
        );
        FixedPoint.Unsigned memory thisPos = _getCollateralizationRatio(
            _getCollateral(positionData.rawCollateral),
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

    /**
     * @dev These internal functions are supposed to act identically to modifiers, but re-used modifiers
     * unneccessarily increase contract bytecode size
     * source: https://blog.polymath.network/solidity-tips-and-tricks-to-save-gas-and-reduce-bytecode-size-c44580b218e6
     */
    function _isPreExpiration() internal view {
        require(getCurrentTime() < expirationTimestamp);
    }

    function _isPostExpiration() internal view {
        require(getCurrentTime() >= expirationTimestamp);
    }

    function _isCollateralizedPosition(address sponsor) internal view {
        require(_getCollateral(positions[sponsor].rawCollateral).isGreaterThan(0));
    }
}
