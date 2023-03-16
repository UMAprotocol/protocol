// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/AncillaryData.sol";

import "../../data-verification-mechanism/implementation/Constants.sol";
import "../../optimistic-oracle-v2/interfaces/OptimisticOracleInterface.sol";
import "../perpetual-multiparty/ConfigStoreInterface.sol";

import "./EmergencyShutdownable.sol";
import "./FeePayer.sol";

/**
 * @title FundingRateApplier contract.
 * @notice Provides funding rate payment functionality for the Perpetual contract.
 */

abstract contract FundingRateApplier is EmergencyShutdownable, FeePayer {
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /****************************************
     * FUNDING RATE APPLIER DATA STRUCTURES *
     ****************************************/

    struct FundingRate {
        // Current funding rate value.
        FixedPoint.Signed rate;
        // Identifier to retrieve the funding rate.
        bytes32 identifier;
        // Tracks the cumulative funding payments that have been paid to the sponsors.
        // The multiplier starts at 1, and is updated by computing cumulativeFundingRateMultiplier * (1 + effectivePayment).
        // Put another way, the cumulativeFeeMultiplier is (1 + effectivePayment1) * (1 + effectivePayment2) ...
        // For example:
        // The cumulativeFundingRateMultiplier should start at 1.
        // If a 1% funding payment is paid to sponsors, the multiplier should update to 1.01.
        // If another 1% fee is charged, the multiplier should be 1.01^2 (1.0201).
        FixedPoint.Unsigned cumulativeMultiplier;
        // Most recent time that the funding rate was updated.
        uint256 updateTime;
        // Most recent time that the funding rate was applied and changed the cumulative multiplier.
        uint256 applicationTime;
        // The time for the active (if it exists) funding rate proposal. 0 otherwise.
        uint256 proposalTime;
    }

    FundingRate public fundingRate;

    // Remote config store managed an owner.
    ConfigStoreInterface public configStore;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event FundingRateUpdated(int256 newFundingRate, uint256 indexed updateTime, uint256 reward);

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    // This is overridden to both pay fees (which is done by applyFundingRate()) and apply the funding rate.
    modifier fees override {
        // Note: the funding rate is applied on every fee-accruing transaction, where the total change is simply the
        // rate applied linearly since the last update. This implies that the compounding rate depends on the frequency
        // of update transactions that have this modifier, and it never reaches the ideal of continuous compounding.
        // This approximate-compounding pattern is common in the Ethereum ecosystem because of the complexity of
        // compounding data on-chain.
        applyFundingRate();
        _;
    }

    // Note: this modifier is intended to be used if the caller intends to _only_ pay regular fees.
    modifier paysRegularFees {
        payRegularFees();
        _;
    }

    /**
     * @notice Constructs the FundingRateApplier contract. Called by child contracts.
     * @param _fundingRateIdentifier identifier that tracks the funding rate of this contract.
     * @param _collateralAddress address of the collateral token.
     * @param _finderAddress Finder used to discover financial-product-related contracts.
     * @param _configStoreAddress address of the remote configuration store managed by an external owner.
     * @param _tokenScaling initial scaling to apply to the token value (i.e. scales the tracking index).
     * @param _timerAddress address of the timer contract in test envs, otherwise 0x0.
     */
    constructor(
        bytes32 _fundingRateIdentifier,
        address _collateralAddress,
        address _finderAddress,
        address _configStoreAddress,
        FixedPoint.Unsigned memory _tokenScaling,
        address _timerAddress
    ) FeePayer(_collateralAddress, _finderAddress, _timerAddress) EmergencyShutdownable() {
        uint256 currentTime = getCurrentTime();
        fundingRate.updateTime = currentTime;
        fundingRate.applicationTime = currentTime;

        // Seed the cumulative multiplier with the token scaling, from which it will be scaled as funding rates are
        // applied over time.
        fundingRate.cumulativeMultiplier = _tokenScaling;

        fundingRate.identifier = _fundingRateIdentifier;
        configStore = ConfigStoreInterface(_configStoreAddress);
    }

    /**
     * @notice This method takes 3 distinct actions:
     * 1. Pays out regular fees.
     * 2. If possible, resolves the outstanding funding rate proposal, pulling the result in and paying out the rewards.
     * 3. Applies the prevailing funding rate over the most recent period.
     */
    function applyFundingRate() public paysRegularFees() nonReentrant() {
        _applyEffectiveFundingRate();
    }

    /**
     * @notice Proposes a new funding rate. Proposer receives a reward if correct.
     * @param rate funding rate being proposed.
     * @param timestamp time at which the funding rate was computed.
     */
    function proposeFundingRate(FixedPoint.Signed memory rate, uint256 timestamp)
        external
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory totalBond)
    {
        require(fundingRate.proposalTime == 0);
        _validateFundingRate(rate);

        // Timestamp must be after the last funding rate update time, within the last 30 minutes.
        uint256 currentTime = getCurrentTime();
        uint256 updateTime = fundingRate.updateTime;
        require(timestamp > updateTime && timestamp >= currentTime.sub(_getConfig().proposalTimePastLimit));

        // Set the proposal time in order to allow this contract to track this request.
        fundingRate.proposalTime = timestamp;

        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        // Set up optimistic oracle.
        bytes32 identifier = fundingRate.identifier;
        bytes memory ancillaryData = _getAncillaryData();
        // Note: requestPrice will revert if `timestamp` is less than the current block timestamp.
        optimisticOracle.requestPrice(identifier, timestamp, ancillaryData, collateralCurrency, 0);
        totalBond = FixedPoint.Unsigned(
            optimisticOracle.setBond(
                identifier,
                timestamp,
                ancillaryData,
                _pfc().mul(_getConfig().proposerBondPercentage).rawValue
            )
        );

        // Pull bond from caller and send to optimistic oracle.
        if (totalBond.isGreaterThan(0)) {
            collateralCurrency.safeTransferFrom(msg.sender, address(this), totalBond.rawValue);
            collateralCurrency.safeIncreaseAllowance(address(optimisticOracle), totalBond.rawValue);
        }

        optimisticOracle.proposePriceFor(
            msg.sender,
            address(this),
            identifier,
            timestamp,
            ancillaryData,
            rate.rawValue
        );
    }

    // Returns a token amount scaled by the current funding rate multiplier.
    // Note: if the contract has paid fees since it was deployed, the raw value should be larger than the returned value.
    function _getFundingRateAppliedTokenDebt(FixedPoint.Unsigned memory rawTokenDebt)
        internal
        view
        returns (FixedPoint.Unsigned memory tokenDebt)
    {
        return rawTokenDebt.mul(fundingRate.cumulativeMultiplier);
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    function _getConfig() internal returns (ConfigStoreInterface.ConfigSettings memory) {
        return configStore.updateAndGetCurrentConfig();
    }

    function _updateFundingRate() internal {
        uint256 proposalTime = fundingRate.proposalTime;
        // If there is no pending proposal then do nothing. Otherwise check to see if we can update the funding rate.
        if (proposalTime != 0) {
            // Attempt to update the funding rate.
            OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
            bytes32 identifier = fundingRate.identifier;
            bytes memory ancillaryData = _getAncillaryData();

            // Try to get the price from the optimistic oracle. This call will revert if the request has not resolved
            // yet. If the request has not resolved yet, then we need to do additional checks to see if we should
            // "forget" the pending proposal and allow new proposals to update the funding rate.
            try optimisticOracle.settleAndGetPrice(identifier, proposalTime, ancillaryData) returns (int256 price) {
                // If successful, determine if the funding rate state needs to be updated.
                // If the request is more recent than the last update then we should update it.
                uint256 lastUpdateTime = fundingRate.updateTime;
                if (proposalTime >= lastUpdateTime) {
                    // Update funding rates
                    fundingRate.rate = FixedPoint.Signed(price);
                    fundingRate.updateTime = proposalTime;

                    // If there was no dispute, send a reward.
                    FixedPoint.Unsigned memory reward = FixedPoint.fromUnscaledUint(0);
                    OptimisticOracleInterface.Request memory request =
                        optimisticOracle.getRequest(address(this), identifier, proposalTime, ancillaryData);
                    if (request.disputer == address(0)) {
                        reward = _pfc().mul(_getConfig().rewardRatePerSecond).mul(proposalTime.sub(lastUpdateTime));
                        if (reward.isGreaterThan(0)) {
                            _adjustCumulativeFeeMultiplier(reward, _pfc());
                            collateralCurrency.safeTransfer(request.proposer, reward.rawValue);
                        }
                    }

                    // This event will only be emitted after the fundingRate struct's "updateTime" has been set
                    // to the latest proposal's proposalTime, indicating that the proposal has been published.
                    // So, it suffices to just emit fundingRate.updateTime here.
                    emit FundingRateUpdated(fundingRate.rate.rawValue, fundingRate.updateTime, reward.rawValue);
                }

                // Set proposal time to 0 since this proposal has now been resolved.
                fundingRate.proposalTime = 0;
            } catch {
                // Stop tracking and allow other proposals to come in if:
                // - The requester address is empty, indicating that the Oracle does not know about this funding rate
                //   request. This is possible if the Oracle is replaced while the price request is still pending.
                // - The request has been disputed.
                OptimisticOracleInterface.Request memory request =
                    optimisticOracle.getRequest(address(this), identifier, proposalTime, ancillaryData);
                if (request.disputer != address(0) || request.proposer == address(0)) {
                    fundingRate.proposalTime = 0;
                }
            }
        }
    }

    // Constraining the range of funding rates limits the PfC for any dishonest proposer and enhances the
    // perpetual's security. For example, let's examine the case where the max and min funding rates
    // are equivalent to +/- 500%/year. This 1000% funding rate range allows a 8.6% profit from corruption for a
    // proposer who can deter honest proposers for 74 hours:
    // 1000%/year / 360 days / 24 hours * 74 hours max attack time = ~ 8.6%.
    // How would attack work? Imagine that the market is very volatile currently and that the "true" funding
    // rate for the next 74 hours is -500%, but a dishonest proposer successfully proposes a rate of +500%
    // (after a two hour liveness) and disputes honest proposers for the next 72 hours. This results in a funding
    // rate error of 1000% for 74 hours, until the DVM can set the funding rate back to its correct value.
    function _validateFundingRate(FixedPoint.Signed memory rate) internal {
        require(
            rate.isLessThanOrEqual(_getConfig().maxFundingRate) &&
                rate.isGreaterThanOrEqual(_getConfig().minFundingRate)
        );
    }

    // Fetches a funding rate from the Store, determines the period over which to compute an effective fee,
    // and multiplies the current multiplier by the effective fee.
    // A funding rate < 1 will reduce the multiplier, and a funding rate of > 1 will increase the multiplier.
    // Note: 1 is set as the neutral rate because there are no negative numbers in FixedPoint, so we decide to treat
    // values < 1 as "negative".
    function _applyEffectiveFundingRate() internal {
        // If contract is emergency shutdown, then the funding rate multiplier should no longer change.
        if (emergencyShutdownTimestamp != 0) {
            return;
        }

        uint256 currentTime = getCurrentTime();
        uint256 paymentPeriod = currentTime.sub(fundingRate.applicationTime);

        _updateFundingRate(); // Update the funding rate if there is a resolved proposal.
        fundingRate.cumulativeMultiplier = _calculateEffectiveFundingRate(
            paymentPeriod,
            fundingRate.rate,
            fundingRate.cumulativeMultiplier
        );

        fundingRate.applicationTime = currentTime;
    }

    function _calculateEffectiveFundingRate(
        uint256 paymentPeriodSeconds,
        FixedPoint.Signed memory fundingRatePerSecond,
        FixedPoint.Unsigned memory currentCumulativeFundingRateMultiplier
    ) internal pure returns (FixedPoint.Unsigned memory newCumulativeFundingRateMultiplier) {
        // Note: this method uses named return variables to save a little bytecode.

        // The overall formula that this function is performing:
        //   newCumulativeFundingRateMultiplier =
        //   (1 + (fundingRatePerSecond * paymentPeriodSeconds)) * currentCumulativeFundingRateMultiplier.
        FixedPoint.Signed memory ONE = FixedPoint.fromUnscaledInt(1);

        // Multiply the per-second rate over the number of seconds that have elapsed to get the period rate.
        FixedPoint.Signed memory periodRate = fundingRatePerSecond.mul(SafeCast.toInt256(paymentPeriodSeconds));

        // Add one to create the multiplier to scale the existing fee multiplier.
        FixedPoint.Signed memory signedPeriodMultiplier = ONE.add(periodRate);

        // Max with 0 to ensure the multiplier isn't negative, then cast to an Unsigned.
        FixedPoint.Unsigned memory unsignedPeriodMultiplier =
            FixedPoint.fromSigned(FixedPoint.max(signedPeriodMultiplier, FixedPoint.fromUnscaledInt(0)));

        // Multiply the existing cumulative funding rate multiplier by the computed period multiplier to get the new
        // cumulative funding rate multiplier.
        newCumulativeFundingRateMultiplier = currentCumulativeFundingRateMultiplier.mul(unsignedPeriodMultiplier);
    }

    /**
     * @dev We do not need to check that the ancillary data length is less than the hardcoded max length in the
     * OptimisticOracle because the length of the ancillary data is fixed in this function.
     */
    function _getAncillaryData() internal view returns (bytes memory) {
        // When ancillary data is passed to the optimistic oracle, it should be tagged with the token address
        // whose funding rate it's trying to get so that financial contracts can re-use the same identifier for
        // multiple funding rate products.
        return AncillaryData.appendKeyValueAddress("", "tokenAddress", _getTokenAddress());
    }

    function _getTokenAddress() internal view virtual returns (address);
}
