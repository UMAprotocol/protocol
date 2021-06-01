// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/AddressWhitelist.sol";

import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../oracle/interfaces/OptimisticOracleInterface.sol";
import "../../oracle/implementation/ContractCreator.sol";

/**
 * @title Optimistic Token Deposit Box
 * @notice This is a minimal example of a financial template that depends on price requests from the Optimistic Oracle.
 * This contract should be thought of as a "Deposit Box" into which the user deposits some ERC20 collateral.
 * The main feature of this box is that the user can withdraw their ERC20 corresponding to a desired USD amount.
 * When the user wants to make a withdrawal, a price request is made to the Optimistic Oracle.
 * For simplicity, the user is constrained to have one outstanding withdrawal request at any given time.
 * Final fees are charged to the proposer of a price but not to the contract making a price request.
 *
 * This example is intended to accompany a technical tutorial for how to integrate the Optimistic Oracle into a project.
 * The main feature this demo serves to showcase is how to build a financial product on-chain that "pulls" price
 * requests from the Optimistic Oracle on-demand, which is an implementation of the "priceless" oracle framework.
 *
 * The typical user flow would be:
 * - User sets up a deposit box for the (wETH - USD) price-identifier. The "collateral currency" in this deposit
 *   box is therefore wETH.
 *   The user can subsequently make withdrawal requests for USD-denominated amounts of wETH.
 * - User deposits 10 wETH into their deposit box.
 * - User later requests to withdraw $1000 USD of wETH.
 * - OptimisticDepositBox asks Optimistic Oracle for latest wETH/USD exchange rate.
 * - Optimistic Oracle resolves the exchange rate at: 1 wETH is worth 2000 USD.
 * - OptimisticDepositBox transfers 0.5 wETH to user.
 */
contract OptimisticDepositBox is Testable {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    // Represents a single caller's deposit box. All collateral is held by this contract.
    struct OptimisticDepositBoxData {
        // Requested amount of collateral, denominated in quote asset of the price identifier.
        // Example: If the price identifier is wETH-USD, and the `withdrawalRequestAmount = 1000`, then
        // this represents a withdrawal request for 1000 USD worth of wETH.
        FixedPoint.Unsigned withdrawalRequestAmount;
        // Timestamp of the latest withdrawal request. A withdrawal request is pending if `requestPassTimestamp != 0`.
        uint256 requestPassTimestamp;
        // Raw collateral value.
        FixedPoint.Unsigned collateral;
    }

    // Maps addresses to their deposit boxes. Each address can have only one position.
    mapping(address => OptimisticDepositBoxData) private depositBoxes;

    // Unique identifier for price feed ticker.
    bytes32 private priceIdentifier;

    // Finder for UMA contracts.
    FinderInterface finder;

    // The collateral currency used to back the positions in this contract.
    IERC20 public collateralCurrency;

    // Total collateral of all depositors.
    FixedPoint.Unsigned private totalOptimisticDepositBoxCollateral;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewOptimisticDepositBox(address indexed user);
    event EndedOptimisticDepositBox(address indexed user);
    event Deposit(address indexed user, uint256 indexed collateralAmount);
    event RequestWithdrawal(address indexed user, uint256 indexed collateralAmount, uint256 requestPassTimestamp);
    event RequestWithdrawalExecuted(
        address indexed user,
        uint256 indexed collateralAmount,
        uint256 exchangeRate,
        uint256 requestPassTimestamp
    );
    event RequestWithdrawalCanceled(
        address indexed user,
        uint256 indexed collateralAmount,
        uint256 requestPassTimestamp
    );

    /****************************************
     *               MODIFIERS              *
     ****************************************/

    modifier noPendingWithdrawal(address user) {
        _depositBoxHasNoPendingWithdrawal(user);
        _;
    }

    /****************************************
     *           PUBLIC FUNCTIONS           *
     ****************************************/

    /**
     * @notice Construct the OptimisticDepositBox.
     * @param _collateralAddress ERC20 token to be deposited.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _priceIdentifier registered in the DVM, used to price the ERC20 deposited.
     * The price identifier consists of a "base" asset and a "quote" asset. The "base" asset corresponds to the collateral ERC20
     * currency deposited into this account, and it is denominated in the "quote" asset on withdrawals.
     * An example price identifier would be "ETH-USD" which will resolve and return the USD price of ETH.
     */
    constructor(
        address _collateralAddress,
        address _finderAddress,
        bytes32 _priceIdentifier
    ) nonReentrant() {
        require(_getCollateralWhitelist().isOnWhitelist(_collateralAddress), "Unsupported currency");
        require(_getIdentifierWhitelist().isIdentifierSupported(_priceIdentifier), "Unsupported identifier");
        collateralCurrency = IERC20(_collateralAddress);
        priceIdentifier = _priceIdentifier;
        finder = FinderInterface(_finderAddress);
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` into caller's deposit box.
     * @dev This contract must be approved to spend at least `collateralAmount` of `collateralCurrency`.
     * @param collateralAmount total amount of collateral tokens to be sent to the sponsor's position.
     */
    function deposit(FixedPoint.Unsigned memory collateralAmount) public nonReentrant() {
        require(collateralAmount.isGreaterThan(0), "Invalid collateral amount");
        OptimisticDepositBoxData storage depositBoxData = depositBoxes[msg.sender];
        if (depositBoxData.collateral.isEqual(0)) {
            emit NewOptimisticDepositBox(msg.sender);
        }

        // Increase the individual deposit box and global collateral balance by collateral amount.
        _incrementCollateralBalances(depositBoxData, collateralAmount);

        emit Deposit(msg.sender, collateralAmount);

        // Move collateral currency from sender to contract.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), collateralAmount);
    }

    /**
     * @notice Starts a withdrawal request that allows the sponsor to withdraw `denominatedCollateralAmount`
     * from their position denominated in the quote asset of the price identifier, following a Optimistic Oracle price resolution.
     * @dev The request will be pending for the duration of the liveness period and can be cancelled at any time.
     * Only one withdrawal request can exist for the user.
     * @param denominatedCollateralAmount the quote-asset denominated amount of collateral requested to withdraw.
     */
    function requestWithdrawal(FixedPoint.Unsigned memory denominatedCollateralAmount)
        public
        noPendingWithdrawal(msg.sender)
        nonReentrant()
    {
        OptimisticDepositBoxData storage depositBoxData = depositBoxes[msg.sender];
        require(denominatedCollateralAmount.isGreaterThan(0), "Invalid collateral amount");

        // Update the position object for the user.
        depositBoxData.withdrawalRequestAmount = denominatedCollateralAmount;
        depositBoxData.requestPassTimestamp = getCurrentTime();

        emit RequestWithdrawal(msg.sender, denominatedCollateralAmount, depositBoxData.requestPassTimestamp);

        // A price request is sent for the current timestamp.
        _requestOraclePrice(depositBoxData.requestPassTimestamp);
    }

    /**
     * @notice After a passed withdrawal request (i.e., by a call to `requestWithdrawal` and subsequent Optimistic Oracle price resolution),
     * withdraws `depositBoxData.withdrawalRequestAmount` of collateral currency denominated in the quote asset.
     * @dev Might not withdraw the full requested amount in order to account for precision loss.
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function executeWithdrawal()
        external
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        OptimisticDepositBoxData storage depositBoxData = depositBoxes[msg.sender];
        require(
            depositBoxData.requestPassTimestamp != 0 && depositBoxData.requestPassTimestamp <= getCurrentTime(),
            "Invalid withdraw request"
        );

        // Get the resolved price or revert.
        FixedPoint.Unsigned memory exchangeRate = _getOraclePrice(depositBoxData.requestPassTimestamp);

        // Calculate denomated amount of collateral based on resolved exchange rate.
        // Example 1: User wants to withdraw $100 of ETH, exchange rate is $200/ETH, therefore user to receive 0.5 ETH.
        // Example 2: User wants to withdraw $250 of ETH, exchange rate is $200/ETH, therefore user to receive 1.25 ETH.
        FixedPoint.Unsigned memory denominatedAmountToWithdraw =
            depositBoxData.withdrawalRequestAmount.div(exchangeRate);

        // If withdrawal request amount is > collateral, then withdraw the full collateral amount and delete the deposit box data.
        if (denominatedAmountToWithdraw.isGreaterThan(_getFeeAdjustedCollateral(depositBoxData.collateral))) {
            denominatedAmountToWithdraw = _getFeeAdjustedCollateral(depositBoxData.collateral);

            // Reset the position state as all the value has been removed after settlement.
            emit EndedOptimisticDepositBox(msg.sender);
        }

        // Decrease the individual deposit box and global collateral balance.
        _decrementCollateralBalances(depositBoxData, denominatedAmountToWithdraw);

        emit RequestWithdrawalExecuted(
            msg.sender,
            denominatedAmountToWithdraw,
            exchangeRate,
            depositBoxData.requestPassTimestamp
        );

        // Reset withdrawal request by setting withdrawal request timestamp to 0.
        _resetWithdrawalRequest(depositBoxData);

        // Transfer approved withdrawal amount from the contract to the caller.
        collateralCurrency.safeTransfer(msg.sender, amountWithdrawn);
    }

    /**
     * @notice Cancels a pending withdrawal request.
     */
    function cancelWithdrawal() external nonReentrant() {
        OptimisticDepositBoxData storage depositBoxData = depositBoxes[msg.sender];
        require(depositBoxData.requestPassTimestamp != 0, "No pending withdrawal");

        emit RequestWithdrawalCanceled(
            msg.sender,
            depositBoxData.withdrawalRequestAmount,
            depositBoxData.requestPassTimestamp
        );

        // Reset withdrawal request by setting withdrawal request timestamp to 0.
        _resetWithdrawalRequest(depositBoxData);
    }

    /**
     * @notice `emergencyShutdown` and `remargin` are required to be implemented by all financial contracts and exposed to the DVM, but
     * because this is a minimal demo they will simply exit silently.
     */
    function emergencyShutdown() external override nonReentrant() {
        return;
    }

    /**
     * @notice Same comment as `emergencyShutdown`. For the sake of simplicity, this will simply exit silently.
     */
    function remargin() external override nonReentrant() {
        return;
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // Requests a price for `priceIdentifier` at `requestedTime` from the Oracle.
    function _requestOraclePrice(uint256 requestedTime) internal {
        OptimisticOracleInterface oracle = _getOptimisticOracle();
        // No ancillary data or reward
        oracle.requestPrice(priceIdentifier, requestedTime, '', address(collateralCurrency), 0);
    }

    // Ensure individual and global consistency when increasing collateral balances. Returns the change to the position.
    function _incrementCollateralBalances(
        OptimisticDepositBoxData storage depositBoxData,
        FixedPoint.Unsigned memory collateralAmount
    ) internal {
        depositBoxData.collateral.add(collateralAmount);
        totalOptimisticDepositBoxCollateral = totalOptimisticDepositBoxCollateral.add(collateralAmount);
    }

    // Ensure individual and global consistency when decrementing collateral balances. Returns the change to the
    // position. We elect to return the amount that the global collateral is decreased by, rather than the individual
    // position's collateral, because we need to maintain the invariant that the global collateral is always
    // <= the collateral owned by the contract to avoid reverts on withdrawals. The amount returned = amount withdrawn.
    function _decrementCollateralBalances(
        OptimisticDepositBoxData storage depositBoxData,
        FixedPoint.Unsigned memory collateralAmount
    ) internal {
        depositBoxData.collateral.sub(collateralAmount);
        totalOptimisticDepositBoxCollateral = totalOptimisticDepositBoxCollateral.sub(collateralAmount);
    }

    function _resetWithdrawalRequest(OptimisticDepositBoxData storage depositBoxData) internal {
        depositBoxData.withdrawalRequestAmount = FixedPoint.fromUnscaledUint(0);
        depositBoxData.requestPassTimestamp = 0;
    }

    function _depositBoxHasNoPendingWithdrawal(address user) internal view {
        require(depositBoxes[user].requestPassTimestamp == 0, "Pending withdrawal");
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    // Fetches a resolved oracle price from the Optimistic Oracle. Reverts if the oracle hasn't resolved for this request.
    function _getOraclePrice(uint256 requestedTime) internal view returns (FixedPoint.Unsigned memory) {
        OptimisticOracleInterface oracle = _getOptimisticOracle();
        require(oracle.hasPrice(priceIdentifier, requestedTime, ''), "Unresolved oracle price");
        int256 oraclePrice = oracle.settleAndGetPrice(priceIdentifier, requestedTime, '');

        // For simplicity we don't want to deal with negative prices.
        if (oraclePrice < 0) {
            oraclePrice = 0;
        }
        return FixedPoint.Unsigned(uint256(oraclePrice));
    }
}
