// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../../common/implementation/FixedPoint.sol";
import "../../common/interfaces/ExpandedIERC20.sol";
import "../../common/interfaces/IERC20Standard.sol";

import "../../data-verification-mechanism/interfaces/OracleInterface.sol";
import "../../optimistic-oracle-v2/interfaces/OptimisticOracleInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";

import "../common/FeePayer.sol";
import "../common/financial-product-libraries/expiring-multiparty-libraries/FinancialProductLibrary.sol";

/**
 * @title Financial contract with priceless position management.
 * @notice Handles positions for multiple sponsors in an optimistic (i.e., priceless) way without relying
 * on a price feed. On construction, deploys a new ERC20, managed by this contract, that is the synthetic token.
 */

contract PricelessPositionManager is FeePayer {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;
    using SafeERC20 for ExpandedIERC20;
    using Address for address;

    /****************************************
     *  PRICELESS POSITION DATA STRUCTURES  *
     ****************************************/

    // Stores the state of the PricelessPositionManager. Set on expiration, emergency shutdown, or settlement.
    enum ContractState { Open, ExpiredPriceRequested, ExpiredPriceReceived }
    ContractState public contractState;

    // Represents a single sponsor's position. All collateral is held by this contract.
    // This struct acts as bookkeeping for how much of that collateral is allocated to each sponsor.
    struct PositionData {
        FixedPoint.Unsigned tokensOutstanding;
        // Tracks pending withdrawal requests. A withdrawal request is pending if `withdrawalRequestPassTimestamp != 0`.
        uint256 withdrawalRequestPassTimestamp;
        FixedPoint.Unsigned withdrawalRequestAmount;
        // Raw collateral value. This value should never be accessed directly -- always use _getFeeAdjustedCollateral().
        // To add or remove collateral, use _addCollateral() and _removeCollateral().
        FixedPoint.Unsigned rawCollateral;
        // Tracks pending transfer position requests. A transfer position request is pending if `transferPositionRequestPassTimestamp != 0`.
        uint256 transferPositionRequestPassTimestamp;
    }

    // Maps sponsor addresses to their positions. Each sponsor can have only one position.
    mapping(address => PositionData) public positions;

    // Keep track of the total collateral and tokens across all positions to enable calculating the
    // global collateralization ratio without iterating over all positions.
    FixedPoint.Unsigned public totalTokensOutstanding;

    // Similar to the rawCollateral in PositionData, this value should not be used directly.
    // _getFeeAdjustedCollateral(), _addCollateral() and _removeCollateral() must be used to access and adjust.
    FixedPoint.Unsigned public rawTotalPositionCollateral;

    // Synthetic token created by this contract.
    ExpandedIERC20 public tokenCurrency;

    // Unique identifier for DVM price feed ticker.
    bytes32 public priceIdentifier;
    // Time that this contract expires. Should not change post-construction unless an emergency shutdown occurs.
    uint256 public expirationTimestamp;
    // Time that has to elapse for a withdrawal request to be considered passed, if no liquidations occur.
    // !!Note: The lower the withdrawal liveness value, the more risk incurred by the contract.
    //       Extremely low liveness values increase the chance that opportunistic invalid withdrawal requests
    //       expire without liquidation, thereby increasing the insolvency risk for the contract as a whole. An insolvent
    //       contract is extremely risky for any sponsor or synthetic token holder for the contract.
    uint256 public withdrawalLiveness;

    // Minimum number of tokens in a sponsor's position.
    FixedPoint.Unsigned public minSponsorTokens;

    // The expiry price pulled from the DVM.
    FixedPoint.Unsigned public expiryPrice;

    // Instance of FinancialProductLibrary to provide custom price and collateral requirement transformations to extend
    // the functionality of the EMP to support a wider range of financial products.
    FinancialProductLibrary public financialProductLibrary;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event RequestTransferPosition(address indexed oldSponsor);
    event RequestTransferPositionExecuted(address indexed oldSponsor, address indexed newSponsor);
    event RequestTransferPositionCanceled(address indexed oldSponsor);
    event Deposit(address indexed sponsor, uint256 indexed collateralAmount);
    event Withdrawal(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawal(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawalExecuted(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawalCanceled(address indexed sponsor, uint256 indexed collateralAmount);
    event PositionCreated(address indexed sponsor, uint256 indexed collateralAmount, uint256 indexed tokenAmount);
    event NewSponsor(address indexed sponsor);
    event EndedSponsorPosition(address indexed sponsor);
    event Repay(address indexed sponsor, uint256 indexed numTokensRepaid, uint256 indexed newTokenCount);
    event Redeem(address indexed sponsor, uint256 indexed collateralAmount, uint256 indexed tokenAmount);
    event ContractExpired(address indexed caller);
    event SettleExpiredPosition(
        address indexed caller,
        uint256 indexed collateralReturned,
        uint256 indexed tokensBurned
    );
    event EmergencyShutdown(address indexed caller, uint256 originalExpirationTimestamp, uint256 shutdownTimestamp);

    /****************************************
     *               MODIFIERS              *
     ****************************************/

    modifier onlyPreExpiration() {
        _onlyPreExpiration();
        _;
    }

    modifier onlyPostExpiration() {
        _onlyPostExpiration();
        _;
    }

    modifier onlyCollateralizedPosition(address sponsor) {
        _onlyCollateralizedPosition(sponsor);
        _;
    }

    // Check that the current state of the pricelessPositionManager is Open.
    // This prevents multiple calls to `expire` and `EmergencyShutdown` post expiration.
    modifier onlyOpenState() {
        _onlyOpenState();
        _;
    }

    modifier noPendingWithdrawal(address sponsor) {
        _positionHasNoPendingWithdrawal(sponsor);
        _;
    }

    /**
     * @notice Construct the PricelessPositionManager
     * @dev Deployer of this contract should consider carefully which parties have ability to mint and burn
     * the synthetic tokens referenced by `_tokenAddress`. This contract's security assumes that no external accounts
     * can mint new tokens, which could be used to steal all of this contract's locked collateral.
     * We recommend to only use synthetic token contracts whose sole Owner role (the role capable of adding & removing roles)
     * is assigned to this contract, whose sole Minter role is assigned to this contract, and whose
     * total supply is 0 prior to construction of this contract.
     * @param _expirationTimestamp unix timestamp of when the contract will expire.
     * @param _withdrawalLiveness liveness delay, in seconds, for pending withdrawals.
     * @param _collateralAddress ERC20 token used as collateral for all positions.
     * @param _tokenAddress ERC20 token used as synthetic token.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _priceIdentifier registered in the DVM for the synthetic.
     * @param _minSponsorTokens minimum number of tokens that must exist at any time in a position.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     * Must be set to 0x0 for production environments that use live time.
     * @param _financialProductLibraryAddress Contract providing contract state transformations.
     */
    constructor(
        uint256 _expirationTimestamp,
        uint256 _withdrawalLiveness,
        address _collateralAddress,
        address _tokenAddress,
        address _finderAddress,
        bytes32 _priceIdentifier,
        FixedPoint.Unsigned memory _minSponsorTokens,
        address _timerAddress,
        address _financialProductLibraryAddress
    ) FeePayer(_collateralAddress, _finderAddress, _timerAddress) nonReentrant() {
        require(_expirationTimestamp > getCurrentTime());
        require(_getIdentifierWhitelist().isIdentifierSupported(_priceIdentifier));

        expirationTimestamp = _expirationTimestamp;
        withdrawalLiveness = _withdrawalLiveness;
        tokenCurrency = ExpandedIERC20(_tokenAddress);
        minSponsorTokens = _minSponsorTokens;
        priceIdentifier = _priceIdentifier;

        // Initialize the financialProductLibrary at the provided address.
        financialProductLibrary = FinancialProductLibrary(_financialProductLibraryAddress);
    }

    /****************************************
     *          POSITION FUNCTIONS          *
     ****************************************/

    /**
     * @notice Requests to transfer ownership of the caller's current position to a new sponsor address.
     * Once the request liveness is passed, the sponsor can execute the transfer and specify the new sponsor.
     * @dev The liveness length is the same as the withdrawal liveness.
     */
    function requestTransferPosition() public onlyPreExpiration() nonReentrant() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.transferPositionRequestPassTimestamp == 0);

        // Make sure the proposed expiration of this request is not post-expiry.
        uint256 requestPassTime = getCurrentTime().add(withdrawalLiveness);
        require(requestPassTime < expirationTimestamp);

        // Update the position object for the user.
        positionData.transferPositionRequestPassTimestamp = requestPassTime;

        emit RequestTransferPosition(msg.sender);
    }

    /**
     * @notice After a passed transfer position request (i.e., by a call to `requestTransferPosition` and waiting
     * `withdrawalLiveness`), transfers ownership of the caller's current position to `newSponsorAddress`.
     * @dev Transferring positions can only occur if the recipient does not already have a position.
     * @param newSponsorAddress is the address to which the position will be transferred.
     */
    function transferPositionPassedRequest(address newSponsorAddress)
        public
        onlyPreExpiration()
        noPendingWithdrawal(msg.sender)
        nonReentrant()
    {
        require(
            _getFeeAdjustedCollateral(positions[newSponsorAddress].rawCollateral).isEqual(
                FixedPoint.fromUnscaledUint(0)
            )
        );
        PositionData storage positionData = _getPositionData(msg.sender);
        require(
            positionData.transferPositionRequestPassTimestamp != 0 &&
                positionData.transferPositionRequestPassTimestamp <= getCurrentTime()
        );

        // Reset transfer request.
        positionData.transferPositionRequestPassTimestamp = 0;

        positions[newSponsorAddress] = positionData;
        delete positions[msg.sender];

        emit RequestTransferPositionExecuted(msg.sender, newSponsorAddress);
        emit NewSponsor(newSponsorAddress);
        emit EndedSponsorPosition(msg.sender);
    }

    /**
     * @notice Cancels a pending transfer position request.
     */
    function cancelTransferPosition() external onlyPreExpiration() nonReentrant() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.transferPositionRequestPassTimestamp != 0);

        emit RequestTransferPositionCanceled(msg.sender);

        // Reset withdrawal request.
        positionData.transferPositionRequestPassTimestamp = 0;
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` into the specified sponsor's position.
     * @dev Increases the collateralization level of a position after creation. This contract must be approved to spend
     * at least `collateralAmount` of `collateralCurrency`.
     * @param sponsor the sponsor to credit the deposit to.
     * @param collateralAmount total amount of collateral tokens to be sent to the sponsor's position.
     */
    function depositTo(address sponsor, FixedPoint.Unsigned memory collateralAmount)
        public
        onlyPreExpiration()
        noPendingWithdrawal(sponsor)
        fees()
        nonReentrant()
    {
        require(collateralAmount.isGreaterThan(0));
        PositionData storage positionData = _getPositionData(sponsor);

        // Increase the position and global collateral balance by collateral amount.
        _incrementCollateralBalances(positionData, collateralAmount);

        emit Deposit(sponsor, collateralAmount.rawValue);

        // Move collateral currency from sender to contract.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), collateralAmount.rawValue);
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` into the caller's position.
     * @dev Increases the collateralization level of a position after creation. This contract must be approved to spend
     * at least `collateralAmount` of `collateralCurrency`.
     * @param collateralAmount total amount of collateral tokens to be sent to the sponsor's position.
     */
    function deposit(FixedPoint.Unsigned memory collateralAmount) public {
        // This is just a thin wrapper over depositTo that specified the sender as the sponsor.
        depositTo(msg.sender, collateralAmount);
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` from the sponsor's position to the sponsor.
     * @dev Reverts if the withdrawal puts this position's collateralization ratio below the global collateralization
     * ratio. In that case, use `requestWithdrawal`. Might not withdraw the full requested amount to account for precision loss.
     * @param collateralAmount is the amount of collateral to withdraw.
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function withdraw(FixedPoint.Unsigned memory collateralAmount)
        public
        onlyPreExpiration()
        noPendingWithdrawal(msg.sender)
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        require(collateralAmount.isGreaterThan(0));
        PositionData storage positionData = _getPositionData(msg.sender);

        // Decrement the sponsor's collateral and global collateral amounts. Check the GCR between decrement to ensure
        // position remains above the GCR within the withdrawal. If this is not the case the caller must submit a request.
        amountWithdrawn = _decrementCollateralBalancesCheckGCR(positionData, collateralAmount);

        emit Withdrawal(msg.sender, amountWithdrawn.rawValue);

        // Move collateral currency from contract to sender.
        // Note: that we move the amount of collateral that is decreased from rawCollateral (inclusive of fees)
        // instead of the user requested amount. This eliminates precision loss that could occur
        // where the user withdraws more collateral than rawCollateral is decremented by.
        collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);
    }

    /**
     * @notice Starts a withdrawal request that, if passed, allows the sponsor to withdraw` from their position.
     * @dev The request will be pending for `withdrawalLiveness`, during which the position can be liquidated.
     * @param collateralAmount the amount of collateral requested to withdraw
     */
    function requestWithdrawal(FixedPoint.Unsigned memory collateralAmount)
        public
        onlyPreExpiration()
        noPendingWithdrawal(msg.sender)
        nonReentrant()
    {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(
            collateralAmount.isGreaterThan(0) &&
                collateralAmount.isLessThanOrEqual(_getFeeAdjustedCollateral(positionData.rawCollateral))
        );

        // Make sure the proposed expiration of this request is not post-expiry.
        uint256 requestPassTime = getCurrentTime().add(withdrawalLiveness);
        require(requestPassTime < expirationTimestamp);

        // Update the position object for the user.
        positionData.withdrawalRequestPassTimestamp = requestPassTime;
        positionData.withdrawalRequestAmount = collateralAmount;

        emit RequestWithdrawal(msg.sender, collateralAmount.rawValue);
    }

    /**
     * @notice After a passed withdrawal request (i.e., by a call to `requestWithdrawal` and waiting
     * `withdrawalLiveness`), withdraws `positionData.withdrawalRequestAmount` of collateral currency.
     * @dev Might not withdraw the full requested amount in order to account for precision loss or if the full requested
     * amount exceeds the collateral in the position (due to paying fees).
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function withdrawPassedRequest()
        external
        onlyPreExpiration()
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(
            positionData.withdrawalRequestPassTimestamp != 0 &&
                positionData.withdrawalRequestPassTimestamp <= getCurrentTime()
        );

        // If withdrawal request amount is > position collateral, then withdraw the full collateral amount.
        // This situation is possible due to fees charged since the withdrawal was originally requested.
        FixedPoint.Unsigned memory amountToWithdraw = positionData.withdrawalRequestAmount;
        if (positionData.withdrawalRequestAmount.isGreaterThan(_getFeeAdjustedCollateral(positionData.rawCollateral))) {
            amountToWithdraw = _getFeeAdjustedCollateral(positionData.rawCollateral);
        }

        // Decrement the sponsor's collateral and global collateral amounts.
        amountWithdrawn = _decrementCollateralBalances(positionData, amountToWithdraw);

        // Reset withdrawal request by setting withdrawal amount and withdrawal timestamp to 0.
        _resetWithdrawalRequest(positionData);

        // Transfer approved withdrawal amount from the contract to the caller.
        collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);

        emit RequestWithdrawalExecuted(msg.sender, amountWithdrawn.rawValue);
    }

    /**
     * @notice Cancels a pending withdrawal request.
     */
    function cancelWithdrawal() external nonReentrant() {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(positionData.withdrawalRequestPassTimestamp != 0);

        emit RequestWithdrawalCanceled(msg.sender, positionData.withdrawalRequestAmount.rawValue);

        // Reset withdrawal request by setting withdrawal amount and withdrawal timestamp to 0.
        _resetWithdrawalRequest(positionData);
    }

    /**
     * @notice Creates tokens by creating a new position or by augmenting an existing position. Pulls `collateralAmount` into the sponsor's position and mints `numTokens` of `tokenCurrency`.
     * @dev Reverts if minting these tokens would put the position's collateralization ratio below the
     * global collateralization ratio. This contract must be approved to spend at least `collateralAmount` of
     * `collateralCurrency`.
     * @dev This contract must have the Minter role for the `tokenCurrency`.
     * @param collateralAmount is the number of collateral tokens to collateralize the position with
     * @param numTokens is the number of tokens to mint from the position.
     */
    function create(FixedPoint.Unsigned memory collateralAmount, FixedPoint.Unsigned memory numTokens)
        public
        onlyPreExpiration()
        fees()
        nonReentrant()
    {
        PositionData storage positionData = positions[msg.sender];

        // Either the new create ratio or the resultant position CR must be above the current GCR.
        require(
            (_checkCollateralization(
                _getFeeAdjustedCollateral(positionData.rawCollateral).add(collateralAmount),
                positionData.tokensOutstanding.add(numTokens)
            ) || _checkCollateralization(collateralAmount, numTokens)),
            "Insufficient collateral"
        );

        require(positionData.withdrawalRequestPassTimestamp == 0, "Pending withdrawal");
        if (positionData.tokensOutstanding.isEqual(0)) {
            require(numTokens.isGreaterThanOrEqual(minSponsorTokens), "Below minimum sponsor position");
            emit NewSponsor(msg.sender);
        }

        // Increase the position and global collateral balance by collateral amount.
        _incrementCollateralBalances(positionData, collateralAmount);

        // Add the number of tokens created to the position's outstanding tokens.
        positionData.tokensOutstanding = positionData.tokensOutstanding.add(numTokens);

        totalTokensOutstanding = totalTokensOutstanding.add(numTokens);

        emit PositionCreated(msg.sender, collateralAmount.rawValue, numTokens.rawValue);

        // Transfer tokens into the contract from caller and mint corresponding synthetic tokens to the caller's address.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), collateralAmount.rawValue);
        require(tokenCurrency.mint(msg.sender, numTokens.rawValue));
    }

    /**
     * @notice Burns `numTokens` of `tokenCurrency` to decrease sponsors position size, without sending back `collateralCurrency`.
     * This is done by a sponsor to increase position CR. Resulting size is bounded by minSponsorTokens.
     * @dev Can only be called by token sponsor. This contract must be approved to spend `numTokens` of `tokenCurrency`.
     * @dev This contract must have the Burner role for the `tokenCurrency`.
     * @param numTokens is the number of tokens to be burnt from the sponsor's debt position.
     */
    function repay(FixedPoint.Unsigned memory numTokens)
        public
        onlyPreExpiration()
        noPendingWithdrawal(msg.sender)
        fees()
        nonReentrant()
    {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(numTokens.isLessThanOrEqual(positionData.tokensOutstanding));

        // Decrease the sponsors position tokens size. Ensure it is above the min sponsor size.
        FixedPoint.Unsigned memory newTokenCount = positionData.tokensOutstanding.sub(numTokens);
        require(newTokenCount.isGreaterThanOrEqual(minSponsorTokens));
        positionData.tokensOutstanding = newTokenCount;

        // Update the totalTokensOutstanding after redemption.
        totalTokensOutstanding = totalTokensOutstanding.sub(numTokens);

        emit Repay(msg.sender, numTokens.rawValue, newTokenCount.rawValue);

        // Transfer the tokens back from the sponsor and burn them.
        tokenCurrency.safeTransferFrom(msg.sender, address(this), numTokens.rawValue);
        tokenCurrency.burn(numTokens.rawValue);
    }

    /**
     * @notice Burns `numTokens` of `tokenCurrency` and sends back the proportional amount of `collateralCurrency`.
     * @dev Can only be called by a token sponsor. Might not redeem the full proportional amount of collateral
     * in order to account for precision loss. This contract must be approved to spend at least `numTokens` of
     * `tokenCurrency`.
     * @dev This contract must have the Burner role for the `tokenCurrency`.
     * @param numTokens is the number of tokens to be burnt for a commensurate amount of collateral.
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function redeem(FixedPoint.Unsigned memory numTokens)
        public
        noPendingWithdrawal(msg.sender)
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        PositionData storage positionData = _getPositionData(msg.sender);
        require(!numTokens.isGreaterThan(positionData.tokensOutstanding));

        FixedPoint.Unsigned memory fractionRedeemed = numTokens.div(positionData.tokensOutstanding);
        FixedPoint.Unsigned memory collateralRedeemed =
            fractionRedeemed.mul(_getFeeAdjustedCollateral(positionData.rawCollateral));

        // If redemption returns all tokens the sponsor has then we can delete their position. Else, downsize.
        if (positionData.tokensOutstanding.isEqual(numTokens)) {
            amountWithdrawn = _deleteSponsorPosition(msg.sender);
        } else {
            // Decrement the sponsor's collateral and global collateral amounts.
            amountWithdrawn = _decrementCollateralBalances(positionData, collateralRedeemed);

            // Decrease the sponsors position tokens size. Ensure it is above the min sponsor size.
            FixedPoint.Unsigned memory newTokenCount = positionData.tokensOutstanding.sub(numTokens);
            require(newTokenCount.isGreaterThanOrEqual(minSponsorTokens), "Below minimum sponsor position");
            positionData.tokensOutstanding = newTokenCount;

            // Update the totalTokensOutstanding after redemption.
            totalTokensOutstanding = totalTokensOutstanding.sub(numTokens);
        }

        emit Redeem(msg.sender, amountWithdrawn.rawValue, numTokens.rawValue);

        // Transfer collateral from contract to caller and burn callers synthetic tokens.
        collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);
        tokenCurrency.safeTransferFrom(msg.sender, address(this), numTokens.rawValue);
        tokenCurrency.burn(numTokens.rawValue);
    }

    /**
     * @notice After a contract has passed expiry all token holders can redeem their tokens for underlying at the
     * prevailing price defined by the DVM from the `expire` function.
     * @dev This burns all tokens from the caller of `tokenCurrency` and sends back the proportional amount of
     * `collateralCurrency`. Might not redeem the full proportional amount of collateral in order to account for
     * precision loss. This contract must be approved to spend `tokenCurrency` at least up to the caller's full balance.
     * @dev This contract must have the Burner role for the `tokenCurrency`.
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function settleExpired()
        external
        onlyPostExpiration()
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        // If the contract state is open and onlyPostExpiration passed then `expire()` has not yet been called.
        require(contractState != ContractState.Open, "Unexpired position");

        // Get the current settlement price and store it. If it is not resolved will revert.
        if (contractState != ContractState.ExpiredPriceReceived) {
            expiryPrice = _getOraclePriceExpiration(expirationTimestamp);
            contractState = ContractState.ExpiredPriceReceived;
        }

        // Get caller's tokens balance and calculate amount of underlying entitled to them.
        FixedPoint.Unsigned memory tokensToRedeem = FixedPoint.Unsigned(tokenCurrency.balanceOf(msg.sender));
        FixedPoint.Unsigned memory totalRedeemableCollateral = tokensToRedeem.mul(expiryPrice);

        // If the caller is a sponsor with outstanding collateral they are also entitled to their excess collateral after their debt.
        PositionData storage positionData = positions[msg.sender];
        if (_getFeeAdjustedCollateral(positionData.rawCollateral).isGreaterThan(0)) {
            // Calculate the underlying entitled to a token sponsor. This is collateral - debt in underlying.
            FixedPoint.Unsigned memory tokenDebtValueInCollateral = positionData.tokensOutstanding.mul(expiryPrice);
            FixedPoint.Unsigned memory positionCollateral = _getFeeAdjustedCollateral(positionData.rawCollateral);

            // If the debt is greater than the remaining collateral, they cannot redeem anything.
            FixedPoint.Unsigned memory positionRedeemableCollateral =
                tokenDebtValueInCollateral.isLessThan(positionCollateral)
                    ? positionCollateral.sub(tokenDebtValueInCollateral)
                    : FixedPoint.Unsigned(0);

            // Add the number of redeemable tokens for the sponsor to their total redeemable collateral.
            totalRedeemableCollateral = totalRedeemableCollateral.add(positionRedeemableCollateral);

            // Reset the position state as all the value has been removed after settlement.
            delete positions[msg.sender];
            emit EndedSponsorPosition(msg.sender);
        }

        // Take the min of the remaining collateral and the collateral "owed". If the contract is undercapitalized,
        // the caller will get as much collateral as the contract can pay out.
        FixedPoint.Unsigned memory payout =
            FixedPoint.min(_getFeeAdjustedCollateral(rawTotalPositionCollateral), totalRedeemableCollateral);

        // Decrement total contract collateral and outstanding debt.
        amountWithdrawn = _removeCollateral(rawTotalPositionCollateral, payout);
        totalTokensOutstanding = totalTokensOutstanding.sub(tokensToRedeem);

        emit SettleExpiredPosition(msg.sender, amountWithdrawn.rawValue, tokensToRedeem.rawValue);

        // Transfer tokens & collateral and burn the redeemed tokens.
        collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);
        tokenCurrency.safeTransferFrom(msg.sender, address(this), tokensToRedeem.rawValue);
        tokenCurrency.burn(tokensToRedeem.rawValue);
    }

    /****************************************
     *        GLOBAL STATE FUNCTIONS        *
     ****************************************/

    /**
     * @notice Locks contract state in expired and requests oracle price.
     * @dev this function can only be called once the contract is expired and can't be re-called.
     */
    function expire() external onlyPostExpiration() onlyOpenState() fees() nonReentrant() {
        contractState = ContractState.ExpiredPriceRequested;

        // Final fees do not need to be paid when sending a request to the optimistic oracle.
        _requestOraclePriceExpiration(expirationTimestamp);

        emit ContractExpired(msg.sender);
    }

    /**
     * @notice Premature contract settlement under emergency circumstances.
     * @dev Only the governor can call this function as they are permissioned within the `FinancialContractAdmin`.
     * Upon emergency shutdown, the contract settlement time is set to the shutdown time. This enables withdrawal
     * to occur via the standard `settleExpired` function. Contract state is set to `ExpiredPriceRequested`
     * which prevents re-entry into this function or the `expire` function. No fees are paid when calling
     * `emergencyShutdown` as the governor who would call the function would also receive the fees.
     */
    function emergencyShutdown() external override onlyPreExpiration() onlyOpenState() nonReentrant() {
        require(msg.sender == _getFinancialContractsAdminAddress());

        contractState = ContractState.ExpiredPriceRequested;
        // Expiratory time now becomes the current time (emergency shutdown time).
        // Price requested at this time stamp. `settleExpired` can now withdraw at this timestamp.
        uint256 oldExpirationTimestamp = expirationTimestamp;
        expirationTimestamp = getCurrentTime();
        _requestOraclePriceExpiration(expirationTimestamp);

        emit EmergencyShutdown(msg.sender, oldExpirationTimestamp, expirationTimestamp);
    }

    /**
     * @notice Theoretically supposed to pay fees and move money between margin accounts to make sure they
     * reflect the NAV of the contract. However, this functionality doesn't apply to this contract.
     * @dev This is supposed to be implemented by any contract that inherits `AdministrateeInterface` and callable
     * only by the Governor contract. This method is therefore minimally implemented in this contract and does nothing.
     */
    function remargin() external override onlyPreExpiration() nonReentrant() {
        return;
    }

    /**
     * @notice Accessor method for a sponsor's collateral.
     * @dev This is necessary because the struct returned by the positions() method shows
     * rawCollateral, which isn't a user-readable value.
     * @dev This method accounts for pending regular fees that have not yet been withdrawn from this contract, for
     * example if the `lastPaymentTime != currentTime`.
     * @param sponsor address whose collateral amount is retrieved.
     * @return collateralAmount amount of collateral within a sponsors position.
     */
    function getCollateral(address sponsor) external view nonReentrantView() returns (FixedPoint.Unsigned memory) {
        // Note: do a direct access to avoid the validity check.
        return _getPendingRegularFeeAdjustedCollateral(_getFeeAdjustedCollateral(positions[sponsor].rawCollateral));
    }

    /**
     * @notice Accessor method for the total collateral stored within the PricelessPositionManager.
     * @return totalCollateral amount of all collateral within the Expiring Multi Party Contract.
     * @dev This method accounts for pending regular fees that have not yet been withdrawn from this contract, for
     * example if the `lastPaymentTime != currentTime`.
     */
    function totalPositionCollateral() external view nonReentrantView() returns (FixedPoint.Unsigned memory) {
        return _getPendingRegularFeeAdjustedCollateral(_getFeeAdjustedCollateral(rawTotalPositionCollateral));
    }

    /**
     * @notice Accessor method to compute a transformed price using the finanicalProductLibrary specified at contract
     * deployment. If no library was provided then no modification to the price is done.
     * @param price input price to be transformed.
     * @param requestTime timestamp the oraclePrice was requested at.
     * @return transformedPrice price with the transformation function applied to it.
     * @dev This method should never revert.
     */

    function transformPrice(FixedPoint.Unsigned memory price, uint256 requestTime)
        public
        view
        nonReentrantView()
        returns (FixedPoint.Unsigned memory)
    {
        return _transformPrice(price, requestTime);
    }

    /**
     * @notice Accessor method to compute a transformed price identifier using the finanicalProductLibrary specified
     * at contract deployment. If no library was provided then no modification to the identifier is done.
     * @param requestTime timestamp the identifier is to be used at.
     * @return transformedPrice price with the transformation function applied to it.
     * @dev This method should never revert.
     */
    function transformPriceIdentifier(uint256 requestTime) public view nonReentrantView() returns (bytes32) {
        return _transformPriceIdentifier(requestTime);
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // Reduces a sponsor's position and global counters by the specified parameters. Handles deleting the entire
    // position if the entire position is being removed. Does not make any external transfers.
    function _reduceSponsorPosition(
        address sponsor,
        FixedPoint.Unsigned memory tokensToRemove,
        FixedPoint.Unsigned memory collateralToRemove,
        FixedPoint.Unsigned memory withdrawalAmountToRemove
    ) internal {
        PositionData storage positionData = _getPositionData(sponsor);

        // If the entire position is being removed, delete it instead.
        if (
            tokensToRemove.isEqual(positionData.tokensOutstanding) &&
            _getFeeAdjustedCollateral(positionData.rawCollateral).isEqual(collateralToRemove)
        ) {
            _deleteSponsorPosition(sponsor);
            return;
        }

        // Decrement the sponsor's collateral and global collateral amounts.
        _decrementCollateralBalances(positionData, collateralToRemove);

        // Ensure that the sponsor will meet the min position size after the reduction.
        FixedPoint.Unsigned memory newTokenCount = positionData.tokensOutstanding.sub(tokensToRemove);
        require(newTokenCount.isGreaterThanOrEqual(minSponsorTokens), "Below minimum sponsor position");
        positionData.tokensOutstanding = newTokenCount;

        // Decrement the position's withdrawal amount.
        positionData.withdrawalRequestAmount = positionData.withdrawalRequestAmount.sub(withdrawalAmountToRemove);

        // Decrement the total outstanding tokens in the overall contract.
        totalTokensOutstanding = totalTokensOutstanding.sub(tokensToRemove);
    }

    // Deletes a sponsor's position and updates global counters. Does not make any external transfers.
    function _deleteSponsorPosition(address sponsor) internal returns (FixedPoint.Unsigned memory) {
        PositionData storage positionToLiquidate = _getPositionData(sponsor);

        FixedPoint.Unsigned memory startingGlobalCollateral = _getFeeAdjustedCollateral(rawTotalPositionCollateral);

        // Remove the collateral and outstanding from the overall total position.
        FixedPoint.Unsigned memory remainingRawCollateral = positionToLiquidate.rawCollateral;
        rawTotalPositionCollateral = rawTotalPositionCollateral.sub(remainingRawCollateral);
        totalTokensOutstanding = totalTokensOutstanding.sub(positionToLiquidate.tokensOutstanding);

        // Reset the sponsors position to have zero outstanding and collateral.
        delete positions[sponsor];

        emit EndedSponsorPosition(sponsor);

        // Return fee-adjusted amount of collateral deleted from position.
        return startingGlobalCollateral.sub(_getFeeAdjustedCollateral(rawTotalPositionCollateral));
    }

    function _pfc() internal view virtual override returns (FixedPoint.Unsigned memory) {
        return _getFeeAdjustedCollateral(rawTotalPositionCollateral);
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
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getOracle() internal view returns (OracleInterface) {
        return OracleInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    function _getFinancialContractsAdminAddress() internal view returns (address) {
        return finder.getImplementationAddress(OracleInterfaces.FinancialContractsAdmin);
    }

    // Requests a price for transformed `priceIdentifier` at `requestedTime` from the Oracle.
    function _requestOraclePriceExpiration(uint256 requestedTime) internal {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        // Increase token allowance to enable the optimistic oracle reward transfer.
        FixedPoint.Unsigned memory reward = _computeFinalFees();
        collateralCurrency.safeIncreaseAllowance(address(optimisticOracle), reward.rawValue);
        optimisticOracle.requestPrice(
            _transformPriceIdentifier(requestedTime),
            requestedTime,
            _getAncillaryData(),
            collateralCurrency,
            reward.rawValue // Reward is equal to the final fee
        );

        // Apply haircut to all sponsors by decrementing the cumlativeFeeMultiplier by the amount lost from the final fee.
        _adjustCumulativeFeeMultiplier(reward, _pfc());
    }

    // Fetches a resolved Oracle price from the Oracle. Reverts if the Oracle hasn't resolved for this request.
    function _getOraclePriceExpiration(uint256 requestedTime) internal returns (FixedPoint.Unsigned memory) {
        // Create an instance of the oracle and get the price. If the price is not resolved revert.
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        require(
            optimisticOracle.hasPrice(
                address(this),
                _transformPriceIdentifier(requestedTime),
                requestedTime,
                _getAncillaryData()
            )
        );
        int256 optimisticOraclePrice =
            optimisticOracle.settleAndGetPrice(
                _transformPriceIdentifier(requestedTime),
                requestedTime,
                _getAncillaryData()
            );

        // For now we don't want to deal with negative prices in positions.
        if (optimisticOraclePrice < 0) {
            optimisticOraclePrice = 0;
        }
        return _transformPrice(FixedPoint.Unsigned(uint256(optimisticOraclePrice)), requestedTime);
    }

    // Requests a price for transformed `priceIdentifier` at `requestedTime` from the Oracle.
    function _requestOraclePriceLiquidation(uint256 requestedTime) internal {
        OracleInterface oracle = _getOracle();
        oracle.requestPrice(_transformPriceIdentifier(requestedTime), requestedTime);
    }

    // Fetches a resolved Oracle price from the Oracle. Reverts if the Oracle hasn't resolved for this request.
    function _getOraclePriceLiquidation(uint256 requestedTime) internal view returns (FixedPoint.Unsigned memory) {
        // Create an instance of the oracle and get the price. If the price is not resolved revert.
        OracleInterface oracle = _getOracle();
        require(oracle.hasPrice(_transformPriceIdentifier(requestedTime), requestedTime), "Unresolved oracle price");
        int256 oraclePrice = oracle.getPrice(_transformPriceIdentifier(requestedTime), requestedTime);

        // For now we don't want to deal with negative prices in positions.
        if (oraclePrice < 0) {
            oraclePrice = 0;
        }
        return _transformPrice(FixedPoint.Unsigned(uint256(oraclePrice)), requestedTime);
    }

    // Reset withdrawal request by setting the withdrawal request and withdrawal timestamp to 0.
    function _resetWithdrawalRequest(PositionData storage positionData) internal {
        positionData.withdrawalRequestAmount = FixedPoint.fromUnscaledUint(0);
        positionData.withdrawalRequestPassTimestamp = 0;
    }

    // Ensure individual and global consistency when increasing collateral balances. Returns the change to the position.
    function _incrementCollateralBalances(
        PositionData storage positionData,
        FixedPoint.Unsigned memory collateralAmount
    ) internal returns (FixedPoint.Unsigned memory) {
        _addCollateral(positionData.rawCollateral, collateralAmount);
        return _addCollateral(rawTotalPositionCollateral, collateralAmount);
    }

    // Ensure individual and global consistency when decrementing collateral balances. Returns the change to the
    // position. We elect to return the amount that the global collateral is decreased by, rather than the individual
    // position's collateral, because we need to maintain the invariant that the global collateral is always
    // <= the collateral owned by the contract to avoid reverts on withdrawals. The amount returned = amount withdrawn.
    function _decrementCollateralBalances(
        PositionData storage positionData,
        FixedPoint.Unsigned memory collateralAmount
    ) internal returns (FixedPoint.Unsigned memory) {
        _removeCollateral(positionData.rawCollateral, collateralAmount);
        return _removeCollateral(rawTotalPositionCollateral, collateralAmount);
    }

    // Ensure individual and global consistency when decrementing collateral balances. Returns the change to the position.
    // This function is similar to the _decrementCollateralBalances function except this function checks position GCR
    // between the decrements. This ensures that collateral removal will not leave the position undercollateralized.
    function _decrementCollateralBalancesCheckGCR(
        PositionData storage positionData,
        FixedPoint.Unsigned memory collateralAmount
    ) internal returns (FixedPoint.Unsigned memory) {
        _removeCollateral(positionData.rawCollateral, collateralAmount);
        require(_checkPositionCollateralization(positionData), "CR below GCR");
        return _removeCollateral(rawTotalPositionCollateral, collateralAmount);
    }

    // These internal functions are supposed to act identically to modifiers, but re-used modifiers
    // unnecessarily increase contract bytecode size.
    // source: https://blog.polymath.network/solidity-tips-and-tricks-to-save-gas-and-reduce-bytecode-size-c44580b218e6
    function _onlyOpenState() internal view {
        require(contractState == ContractState.Open, "Contract state is not OPEN");
    }

    function _onlyPreExpiration() internal view {
        require(getCurrentTime() < expirationTimestamp, "Only callable pre-expiry");
    }

    function _onlyPostExpiration() internal view {
        require(getCurrentTime() >= expirationTimestamp, "Only callable post-expiry");
    }

    function _onlyCollateralizedPosition(address sponsor) internal view {
        require(
            _getFeeAdjustedCollateral(positions[sponsor].rawCollateral).isGreaterThan(0),
            "Position has no collateral"
        );
    }

    // Note: This checks whether an already existing position has a pending withdrawal. This cannot be used on the
    // `create` method because it is possible that `create` is called on a new position (i.e. one without any collateral
    // or tokens outstanding) which would fail the `onlyCollateralizedPosition` modifier on `_getPositionData`.
    function _positionHasNoPendingWithdrawal(address sponsor) internal view {
        require(_getPositionData(sponsor).withdrawalRequestPassTimestamp == 0, "Pending withdrawal");
    }

    /****************************************
     *          PRIVATE FUNCTIONS          *
     ****************************************/

    function _checkPositionCollateralization(PositionData storage positionData) private view returns (bool) {
        return
            _checkCollateralization(
                _getFeeAdjustedCollateral(positionData.rawCollateral),
                positionData.tokensOutstanding
            );
    }

    // Checks whether the provided `collateral` and `numTokens` have a collateralization ratio above the global
    // collateralization ratio.
    function _checkCollateralization(FixedPoint.Unsigned memory collateral, FixedPoint.Unsigned memory numTokens)
        private
        view
        returns (bool)
    {
        FixedPoint.Unsigned memory global =
            _getCollateralizationRatio(_getFeeAdjustedCollateral(rawTotalPositionCollateral), totalTokensOutstanding);
        FixedPoint.Unsigned memory thisChange = _getCollateralizationRatio(collateral, numTokens);
        return !global.isGreaterThan(thisChange);
    }

    function _getCollateralizationRatio(FixedPoint.Unsigned memory collateral, FixedPoint.Unsigned memory numTokens)
        private
        pure
        returns (FixedPoint.Unsigned memory ratio)
    {
        if (!numTokens.isGreaterThan(0)) {
            return FixedPoint.fromUnscaledUint(0);
        } else {
            return collateral.div(numTokens);
        }
    }

    // IERC20Standard.decimals() will revert if the collateral contract has not implemented the decimals() method,
    // which is possible since the method is only an OPTIONAL method in the ERC20 standard:
    // https://eips.ethereum.org/EIPS/eip-20#methods.
    function _getSyntheticDecimals(address _collateralAddress) public view returns (uint8 decimals) {
        try IERC20Standard(_collateralAddress).decimals() returns (uint8 _decimals) {
            return _decimals;
        } catch {
            return 18;
        }
    }

    function _transformPrice(FixedPoint.Unsigned memory price, uint256 requestTime)
        internal
        view
        returns (FixedPoint.Unsigned memory)
    {
        if (!address(financialProductLibrary).isContract()) return price;
        try financialProductLibrary.transformPrice(price, requestTime) returns (
            FixedPoint.Unsigned memory transformedPrice
        ) {
            return transformedPrice;
        } catch {
            return price;
        }
    }

    function _transformPriceIdentifier(uint256 requestTime) internal view returns (bytes32) {
        if (!address(financialProductLibrary).isContract()) return priceIdentifier;
        try financialProductLibrary.transformPriceIdentifier(priceIdentifier, requestTime) returns (
            bytes32 transformedIdentifier
        ) {
            return transformedIdentifier;
        } catch {
            return priceIdentifier;
        }
    }

    function _getAncillaryData() internal view returns (bytes memory) {
        // Note: when ancillary data is passed to the optimistic oracle, it should be tagged with the token address
        // whose funding rate it's trying to get.
        return abi.encodePacked(address(tokenCurrency));
    }
}
