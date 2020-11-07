pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../funding-rate-store/interfaces/FundingRateStoreInterface.sol";
import "./FeePayer.sol";

/**
 * @title FundingRatePayer contract.
 * @notice Extends FeePayer by adding funding rate store payment functionality for any financial contract that needs
 * to access a funding rate. Contract is abstract as each derived contract that inherits `FundingRatePayer` must
 * implement `pfc()`.
 */

abstract contract FundingRatePayer is FeePayer {
    /****************************************
     *      FEE PAYER DATA STRUCTURES       *
     ****************************************/

    // Tracks the last block time when the fees were paid.
    uint256 private lastPaymentTime;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event FundingRateFeesPaid(uint256 indexed fundingRateFee, uint256 indexed lateFee);

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    // modifier that calls continuous fee paying methods.
    modifier fees override {
        payRegularFees();
        payFundingRateFees();
        _;
    }

    /**
     * @notice Constructs the FundingRatePayer contract. Called by child contracts.
     * @param _collateralAddress ERC20 token that is used as the underlying collateral for the synthetic.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     * Must be set to 0x0 for production environments that use live time.
     */
    constructor(
        address _collateralAddress,
        address _finderAddress,
        address _timerAddress
    ) public FeePayer(_collateralAddress, _finderAddress, _timerAddress) {
        lastPaymentTime = getCurrentTime();
    }

    /****************************************
     *        FEE PAYMENT FUNCTIONS         *
     ****************************************/

    /**
     * @notice Pays continuous fees (as a % of the collateral pool) to the FundingRateStore contract.
     * @dev These must be paid periodically for the life of the contract. If the contract has not paid its fee
     * in a week or more then a late penalty is applied which is sent to the caller. If the amount of
     * fees owed are greater than the pfc, then this will pay as much as possible from the available collateral.
     * An event is only fired if the fees charged are greater than 0.
     * @return totalPaid Amount of collateral that the contract paid (sum of the amount paid to the Store and caller).
     * This returns 0 and exit early if there is no pfc, fees were already paid during the current block, or the fee rate is 0.
     */
    function payFundingRateFees() public nonReentrant() returns (FixedPoint.Unsigned memory totalPaid) {
        FundingRateStoreInterface fundingRateStore = FundingRateStoreInterface(
            finder.getImplementationAddress("FundingRateStore")
        );
        uint256 time = getCurrentTime();
        FixedPoint.Unsigned memory collateralPool = _pfc();

        // Exit early if there is no collateral from which to pay fees.
        if (collateralPool.isEqual(0)) {
            return totalPaid;
        }

        // Exit early if fees were already paid during this block.
        if (lastPaymentTime == time) {
            return totalPaid;
        }

        (FixedPoint.Unsigned memory fundingRateFee, FixedPoint.Unsigned memory latePenalty) = fundingRateStore
            .computeFundingRateFee(lastPaymentTime, time, collateralPool);
        lastPaymentTime = time;

        totalPaid = fundingRateFee.add(latePenalty);
        if (totalPaid.isEqual(0)) {
            return totalPaid;
        }
        // If the effective fees paid as a % of the pfc is > 100%, then we need to reduce it and make the contract pay
        // as much of the fee that it can (up to 100% of its pfc). We'll reduce the late penalty first and then the
        // regular fee, which has the effect of paying the store first, followed by the caller if there is any fee remaining.
        if (totalPaid.isGreaterThan(collateralPool)) {
            FixedPoint.Unsigned memory deficit = totalPaid.sub(collateralPool);
            FixedPoint.Unsigned memory latePenaltyReduction = FixedPoint.min(latePenalty, deficit);
            latePenalty = latePenalty.sub(latePenaltyReduction);
            deficit = deficit.sub(latePenaltyReduction);
            fundingRateFee = fundingRateFee.sub(FixedPoint.min(fundingRateFee, deficit));
            totalPaid = collateralPool;
        }

        emit FundingRateFeesPaid(fundingRateFee.rawValue, latePenalty.rawValue);

        _adjustCumulativeFeeMultiplier(totalPaid, collateralPool);

        if (fundingRateFee.isGreaterThan(0)) {
            collateralCurrency.safeIncreaseAllowance(address(fundingRateStore), fundingRateFee.rawValue);
            fundingRateStore.payFundingRateFees(fundingRateFee);
        }

        if (latePenalty.isGreaterThan(0)) {
            collateralCurrency.safeTransfer(msg.sender, latePenalty.rawValue);
        }
        return totalPaid;
    }
}
