// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/AddressWhitelist.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";

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
contract OptimisticDepositBox is Testable, Lockable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Represents a single caller's deposit box. All collateral is held by this contract.
    struct OptimisticDepositBoxData {
        // Requested amount of collateral, denominated in quote asset of the price identifier.
        // Example: If the price identifier is wETH-USD, and the `withdrawalRequestAmount = 1000`, then
        // this represents a withdrawal request for 1000 USD worth of wETH.
        uint256 withdrawalRequestAmount;
        // Timestamp of the latest withdrawal request. A withdrawal request is pending if `requestPassTimestamp != 0`.
        uint256 requestPassTimestamp;
        // Collateral value.
        uint256 collateral;
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
    uint256 public totalOptimisticDepositBoxCollateral;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewOptimisticDepositBox(address indexed user);
    event EndedOptimisticDepositBox(address indexed user);
    event Deposit(address indexed user, uint256 indexed collateralAmount);
    event RequestWithdrawal(
      address indexed user,
      uint256 indexed collateralAmount,
      uint256 requestPassTimestamp
    );
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
     * @param _timerAddress Contract that stores the current time in a testing environment.
     * Must be set to 0x0 for production environments that use live time.
     */
    constructor(
        address _collateralAddress,
        address _finderAddress,
        bytes32 _priceIdentifier,
        address _timerAddress
    ) nonReentrant() Testable(_timerAddress) {
        // require(_getIdentifierWhitelist().isIdentifierSupported(_priceIdentifier), "Unsupported identifier");
        collateralCurrency = IERC20(_collateralAddress);
        priceIdentifier = _priceIdentifier;
        finder = FinderInterface(_finderAddress);
    }

    /**
     * @notice Transfers `collateralAmount` of `collateralCurrency` into caller's deposit box.
     * @dev This contract must be approved to spend at least `collateralAmount` of `collateralCurrency`.
     * @param collateralAmount total amount of collateral tokens to be sent to the sponsor's position.
     */
    function deposit(uint256 collateralAmount) public nonReentrant() {
        require(collateralAmount > 0, "Invalid collateral amount");
        OptimisticDepositBoxData storage depositBoxData = depositBoxes[msg.sender];
        if (depositBoxData.collateral == 0) {
            emit NewOptimisticDepositBox(msg.sender);
        }

        // Increase the individual deposit box and global collateral balance by collateral amount.
        // depositBoxData.collateral.add(collateralAmount);
        depositBoxData.collateral = depositBoxData.collateral.add(collateralAmount);
        require(depositBoxData.collateral > 0, "Collateral not added");
        totalOptimisticDepositBoxCollateral = totalOptimisticDepositBoxCollateral.add(collateralAmount);

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
    function requestWithdrawal(uint256 denominatedCollateralAmount)
        public
        noPendingWithdrawal(msg.sender)
        nonReentrant()
    {
        OptimisticDepositBoxData storage depositBoxData = depositBoxes[msg.sender];
        require(denominatedCollateralAmount > 0, "Invalid collateral amount");

        // Update the position object for the user.
        depositBoxData.withdrawalRequestAmount = denominatedCollateralAmount;
        depositBoxData.requestPassTimestamp = getCurrentTime();

        emit RequestWithdrawal(msg.sender, denominatedCollateralAmount, depositBoxData.requestPassTimestamp);

        // A price request is sent for the current timestamp.
        _requestOraclePrice(depositBoxData.requestPassTimestamp);
    }

    /**
     * @notice After a withdrawal request (i.e., by a call to `requestWithdrawal`) and optimistic oracle price resolution,
     * withdraws `depositBoxData.withdrawalRequestAmount` of collateral currency denominated in the quote asset.
     * @dev Might not withdraw the full requested amount in order to account for precision loss.
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function executeWithdrawal()
        external
        nonReentrant()
        returns (uint256 amountWithdrawn)
    {
        OptimisticDepositBoxData storage depositBoxData = depositBoxes[msg.sender];
        require(
            depositBoxData.requestPassTimestamp != 0 && depositBoxData.requestPassTimestamp <= getCurrentTime(),
            "Invalid withdraw request"
        );

        // Get the resolved price or revert.
        uint256 exchangeRate = _getOraclePrice(depositBoxData.requestPassTimestamp);

        // Calculate denomated amount of collateral based on resolved exchange rate.
        // Example 1: User wants to withdraw $1000 of ETH, exchange rate is $2000/ETH, therefore user to receive 0.5 ETH.
        // Example 2: User wants to withdraw $2500 of ETH, exchange rate is $2000/ETH, therefore user to receive 1.25 ETH.
        uint256 denominatedAmountToWithdraw =
            depositBoxData.withdrawalRequestAmount.div(exchangeRate);

        // If withdrawal request amount is > collateral, then withdraw the full collateral amount and delete the deposit box data.
        if (denominatedAmountToWithdraw > depositBoxData.collateral) {
            denominatedAmountToWithdraw = depositBoxData.collateral;

            // Reset the position state as all the value has been removed after settlement.
            emit EndedOptimisticDepositBox(msg.sender);
        }

        // Decrease the individual deposit box and global collateral balance.
        depositBoxData.collateral = depositBoxData.collateral.sub(denominatedAmountToWithdraw);
        totalOptimisticDepositBoxCollateral = totalOptimisticDepositBoxCollateral.sub(denominatedAmountToWithdraw);

        emit RequestWithdrawalExecuted(
            msg.sender,
            denominatedAmountToWithdraw,
            exchangeRate,
            depositBoxData.requestPassTimestamp
        );

        // Reset withdrawal request by setting withdrawal request timestamp to 0.
        _resetWithdrawalRequest(depositBoxData);

        // Transfer approved withdrawal amount from the contract to the caller.
        collateralCurrency.safeTransfer(msg.sender, denominatedAmountToWithdraw);
        return denominatedAmountToWithdraw;
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
     * @notice Accessor method for a user's collateral.
     * @param user address whose collateral amount is retrieved.
     * @return the collateral amount in the deposit box (i.e. available for withdrawal).
     */
    function getCollateral(address user) external view nonReentrantView() returns (uint256) {
        return depositBoxes[user].collateral;
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // Requests a price for `priceIdentifier` at `requestedTime` from the Oracle.
    function _requestOraclePrice(uint256 requestedTime) internal {
        OptimisticOracleInterface oracle = _getOptimisticOracle();
        // No ancillary data or reward
        oracle.requestPrice(priceIdentifier, requestedTime, '', IERC20(collateralCurrency), 0);
    }

    function _resetWithdrawalRequest(OptimisticDepositBoxData storage depositBoxData) internal {
        depositBoxData.withdrawalRequestAmount = 0;
        depositBoxData.requestPassTimestamp = 0;
    }

    function _depositBoxHasNoPendingWithdrawal(address user) internal view {
        require(depositBoxes[user].requestPassTimestamp == 0, "Pending withdrawal");
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    // Fetches a resolved oracle price from the Optimistic Oracle. Reverts if the oracle hasn't resolved for this request.
    function _getOraclePrice(uint256 requestPassTimestamp) internal returns (uint256) {
        OptimisticOracleInterface oracle = _getOptimisticOracle();
        require(oracle.hasPrice(address(this), priceIdentifier, requestPassTimestamp, ''), "Unresolved oracle price");
        int256 oraclePrice = oracle.settleAndGetPrice(priceIdentifier, requestPassTimestamp, '');
        // int256 oraclePrice = 2000;

        // For simplicity we don't want to deal with negative prices.
        if (oraclePrice < 0) {
            oraclePrice = 0;
        }
        return uint256(oraclePrice);
    }
}
