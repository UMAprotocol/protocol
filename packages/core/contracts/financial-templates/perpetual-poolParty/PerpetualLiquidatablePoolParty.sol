// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./PerpetualPositionManagerPoolParty.sol";

import "../../common/implementation/FixedPoint.sol";
import "./PerpetualPositionManagerPoolPartyLib.sol";
import "./PerpetualLiquidatablePoolPartyLib.sol";


/**
 * @title PerpetualLiquidatable
 * @notice Adds logic to a position-managing contract that enables callers to liquidate an undercollateralized position.
 * @dev The liquidation has a liveness period before expiring successfully, during which someone can "dispute" the
 * liquidation, which sends a price request to the relevant Oracle to settle the final collateralization ratio based on
 * a DVM price. The contract enforces dispute rewards in order to incentivize disputers to correctly dispute false
 * liquidations and compensate position sponsors who had their position incorrectly liquidated. Importantly, a
 * prospective disputer must deposit a dispute bond that they can lose in the case of an unsuccessful dispute.
 */
contract PerpetualLiquidatablePoolParty is PerpetualPositionManagerPoolParty {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using FeePayerPoolPartyLib for FixedPoint.Unsigned;
    using PerpetualLiquidatablePoolPartyLib for PerpetualPositionManagerPoolParty.PositionData;
    using PerpetualLiquidatablePoolPartyLib for LiquidationData;

    /****************************************
     *     LIQUIDATION DATA STRUCTURES      *
     ****************************************/

    // Because of the check in withdrawable(), the order of these enum values should not change.
    enum Status { Uninitialized, PreDispute, PendingDispute, DisputeSucceeded, DisputeFailed }

    struct LiquidatableParams {
        uint256 liquidationLiveness;
        FixedPoint.Unsigned collateralRequirement;
        FixedPoint.Unsigned disputeBondPct;
        FixedPoint.Unsigned sponsorDisputeRewardPct;
        FixedPoint.Unsigned disputerDisputeRewardPct;
    }

    struct LiquidationData {
        // Following variables set upon creation of liquidation:
        address sponsor; // Address of the liquidated position's sponsor
        address liquidator; // Address who created this liquidation
        Status state; // Liquidated (and expired or not), Pending a Dispute, or Dispute has resolved
        uint256 liquidationTime; // Time when liquidation is initiated, needed to get price from Oracle
        // Following variables determined by the position that is being liquidated:
        FixedPoint.Unsigned tokensOutstanding; // Synthetic tokens required to be burned by liquidator to initiate dispute
        FixedPoint.Unsigned lockedCollateral; // Collateral locked by contract and released upon expiry or post-dispute
        // Amount of collateral being liquidated, which could be different from
        // lockedCollateral if there were pending withdrawals at the time of liquidation
        FixedPoint.Unsigned liquidatedCollateral;
        // Unit value (starts at 1) that is used to track the fees per unit of collateral over the course of the liquidation.
        FixedPoint.Unsigned rawUnitCollateral;
        // Following variable set upon initiation of a dispute:
        address disputer; // Person who is disputing a liquidation
        // Following variable set upon a resolution of a dispute:
        FixedPoint.Unsigned settlementPrice; // Final price as determined by an Oracle following a dispute
        FixedPoint.Unsigned finalFee;
    }

    // Define the contract's constructor parameters as a struct to enable more variables to be specified.
    // This is required to enable more params, over and above Solidity's limits.
    struct ConstructorParams {
        // Params for PricelessPositionManager only.
        PerpetualPositionManagerPoolParty.PositionManagerParams positionManagerParams;
        PerpetualPositionManagerPoolParty.Roles roles;
        // Params specifically for Liquidatable.
        LiquidatableParams liquidatableParams;
    }

    struct LiquidatableData {
        // Total collateral in liquidation.
        FixedPoint.Unsigned rawLiquidationCollateral;
        // Immutable contract parameters:
        // Amount of time for pending liquidation before expiry.
        // !!Note: The lower the liquidation liveness value, the more risk incurred by sponsors.
        //       Extremely low liveness values increase the chance that opportunistic invalid liquidations
        //       expire without dispute, thereby decreasing the usability for sponsors and increasing the risk
        //       for the contract as a whole. An insolvent contract is extremely risky for any sponsor or synthetic
        //       token holder for the contract.
        uint256 liquidationLiveness;
        // Required collateral:TRV ratio for a position to be considered sufficiently collateralized.
        FixedPoint.Unsigned collateralRequirement;
        // Percent of a Liquidation/Position's lockedCollateral to be deposited by a potential disputer
        // Represented as a multiplier, for example 1.5e18 = "150%" and 0.05e18 = "5%"
        FixedPoint.Unsigned disputeBondPct;
        // Percent of oraclePrice paid to sponsor in the Disputed state (i.e. following a successful dispute)
        // Represented as a multiplier, see above.
        FixedPoint.Unsigned sponsorDisputeRewardPct;
        // Percent of oraclePrice paid to disputer in the Disputed state (i.e. following a successful dispute)
        // Represented as a multiplier, see above.
        FixedPoint.Unsigned disputerDisputeRewardPct;
    }

    // This struct is used in the `withdrawLiquidation` method that disperses liquidation and dispute rewards.
    // `payToX` stores the total collateral to withdraw from the contract to pay X. This value might differ
    // from `paidToX` due to precision loss between accounting for the `rawCollateral` versus the
    // fee-adjusted collateral. These variables are stored within a struct to avoid the stack too deep error.
    struct RewardsData {
        FixedPoint.Unsigned payToSponsor;
        FixedPoint.Unsigned payToLiquidator;
        FixedPoint.Unsigned payToDisputer;
        FixedPoint.Unsigned paidToSponsor;
        FixedPoint.Unsigned paidToLiquidator;
        FixedPoint.Unsigned paidToDisputer;
    }

    // Liquidations are unique by ID per sponsor
    mapping(address => LiquidationData[]) public liquidations;

    LiquidatableData public liquidatableData;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event LiquidationCreated(
        address indexed sponsor,
        address indexed liquidator,
        uint256 indexed liquidationId,
        uint256 tokensOutstanding,
        uint256 lockedCollateral,
        uint256 liquidatedCollateral,
        uint256 liquidationTime
    );
    event LiquidationDisputed(
        address indexed sponsor,
        address indexed liquidator,
        address indexed disputer,
        uint256 liquidationId,
        uint256 disputeBondAmount
    );
    event DisputeSettled(
        address indexed caller,
        address indexed sponsor,
        address indexed liquidator,
        address disputer,
        uint256 liquidationId,
        bool disputeSucceeded
    );
    event LiquidationWithdrawn(
        address indexed caller,
        uint256 paidToLiquidator,
        uint256 paidToDisputer,
        uint256 paidToSponsor,
        Status indexed liquidationStatus,
        uint256 settlementPrice
    );

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier disputable(uint256 liquidationId, address sponsor) {
        _disputable(liquidationId, sponsor);
        _;
    }

    modifier withdrawable(uint256 liquidationId, address sponsor) {
        _withdrawable(liquidationId, sponsor);
        _;
    }

    /**
     * @notice Constructs the liquidatable contract.
     * @param params struct to define input parameters for construction of Liquidatable. Some params
     * are fed directly into the PositionManager's constructor within the inheritance tree.
     */
    constructor(ConstructorParams memory params)
        public
        PerpetualPositionManagerPoolParty(params.positionManagerParams, params.roles)
    {
        require(params.liquidatableParams.collateralRequirement.isGreaterThan(1), "CR is more than 100%");
        require(
            params
                .liquidatableParams
                .sponsorDisputeRewardPct
                .add(params.liquidatableParams.disputerDisputeRewardPct)
                .isLessThan(1),
            "Rewards are more than 100%"
        );
        // Set liquidatable specific variables.
        liquidatableData.liquidationLiveness = params.liquidatableParams.liquidationLiveness;
        liquidatableData.collateralRequirement = params.liquidatableParams.collateralRequirement;
        liquidatableData.disputeBondPct = params.liquidatableParams.disputeBondPct;
        liquidatableData.sponsorDisputeRewardPct = params.liquidatableParams.sponsorDisputeRewardPct;
        liquidatableData.disputerDisputeRewardPct = params.liquidatableParams.disputerDisputeRewardPct;
    }

    /****************************************
     *        LIQUIDATION FUNCTIONS         *
     ****************************************/

    /**
     * @notice Liquidates the sponsor's position if the caller has enough
     * synthetic tokens to retire the position's outstanding tokens. Liquidations above
     * a minimum size also reset an ongoing "slow withdrawal"'s liveness.
     * @dev This method generates an ID that will uniquely identify liquidation for the sponsor. This contract must be
     * approved to spend at least `tokensLiquidated` of `tokenCurrency` and at least `finalFeeBond` of `feePayerData.collateralCurrency`.
     * @param sponsor address of the sponsor to liquidate.
     * @param minCollateralPerToken abort the liquidation if the position's collateral per token is below this value.
     * @param maxCollateralPerToken abort the liquidation if the position's collateral per token exceeds this value.
     * @param maxTokensToLiquidate max number of tokens to liquidate.
     * @param deadline abort the liquidation if the transaction is mined after this timestamp.
     * @return liquidationId ID of the newly created liquidation.
     * @return tokensLiquidated amount of synthetic tokens removed and liquidated from the `sponsor`'s position.
     * @return finalFeeBond amount of collateral to be posted by liquidator and returned if not disputed successfully.
     */
    function createLiquidation(
        address sponsor,
        FixedPoint.Unsigned calldata minCollateralPerToken,
        FixedPoint.Unsigned calldata maxCollateralPerToken,
        FixedPoint.Unsigned calldata maxTokensToLiquidate,
        uint256 deadline
    )
        external
        fees()
        notEmergencyShutdown()
        nonReentrant()
        returns (
            uint256 liquidationId,
            FixedPoint.Unsigned memory tokensLiquidated,
            FixedPoint.Unsigned memory finalFeeBond
        )
    {
        // Retrieve Position data for sponsor
        PositionData storage positionToLiquidate = _getPositionData(sponsor);

        LiquidationData[] storage TokenSponsorLiquidations = liquidations[sponsor];

        // Compute final fee at time of liquidation.
        FixedPoint.Unsigned memory finalFee = _computeFinalFees();

        uint256 actualTime = getCurrentTime();

        PerpetualLiquidatablePoolPartyLib.CreateLiquidationParams memory params = PerpetualLiquidatablePoolPartyLib
            .CreateLiquidationParams(
            minCollateralPerToken,
            maxCollateralPerToken,
            maxTokensToLiquidate,
            actualTime,
            deadline,
            finalFee,
            sponsor
        );

        PerpetualLiquidatablePoolPartyLib.CreateLiquidationReturnParams memory returnValues;

        returnValues = positionToLiquidate.createLiquidation(
            globalPositionData,
            positionManagerData,
            liquidatableData,
            TokenSponsorLiquidations,
            params,
            feePayerData
        );

        return (returnValues.liquidationId, returnValues.tokensLiquidated, returnValues.finalFeeBond);
    }

    /**
     * @notice Disputes a liquidation, if the caller has enough collateral to post a dispute bond
     * and pay a fixed final fee charged on each price request.
     * @dev Can only dispute a liquidation before the liquidation expires and if there are no other pending disputes.
     * This contract must be approved to spend at least the dispute bond amount of `feePayerData.collateralCurrency`. This dispute
     * bond amount is calculated from `disputeBondPct` times the collateral in the liquidation.
     * @param liquidationId of the disputed liquidation.
     * @param sponsor the address of the sponsor whose liquidation is being disputed.
     * @return totalPaid amount of collateral charged to disputer (i.e. final fee bond + dispute bond).
     */
    function dispute(uint256 liquidationId, address sponsor)
        external
        disputable(liquidationId, sponsor)
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory totalPaid)
    {
        LiquidationData storage disputedLiquidation = _getLiquidationData(sponsor, liquidationId);

        totalPaid = disputedLiquidation.dispute(
            liquidatableData,
            positionManagerData,
            feePayerData,
            liquidationId,
            sponsor
        );
    }

    /**
     * @notice After a dispute has settled or after a non-disputed liquidation has expired,
     * anyone can call this method to disperse payments to the sponsor, liquidator, and disputer.
     * @dev If the dispute SUCCEEDED: the sponsor, liquidator, and disputer are eligible for payment.
     * If the dispute FAILED: only the liquidator receives payment. This method deletes the liquidation data.
     * This method will revert if rewards have already been dispersed.
     * @param liquidationId uniquely identifies the sponsor's liquidation.
     * @param sponsor address of the sponsor associated with the liquidation.
     * @return data about rewards paid out.
     */
    function withdrawLiquidation(uint256 liquidationId, address sponsor)
        public
        withdrawable(liquidationId, sponsor)
        fees()
        nonReentrant()
        returns (RewardsData memory)
    {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, liquidationId);

        RewardsData memory rewardsData = liquidation.withdrawLiquidation(
            liquidatableData,
            positionManagerData,
            feePayerData,
            liquidationId,
            sponsor
        );

        return rewardsData;
    }

    /**
     * @notice Delete liquidation of a TokenSponsor (This function can only be called by the contract itself)
     * @param liquidationId id of the liquidation.
     * @param sponsor address of the TokenSponsor.
     */
    function deleteLiquidation(uint256 liquidationId, address sponsor) external onlyThisContract {
        delete liquidations[sponsor][liquidationId];
    }

    /**
     * @notice Gets all liquidation information for a given sponsor address.
     * @param sponsor address of the position sponsor.
     * @return liquidationData array of all liquidation information for the given sponsor address.
     */
    function getLiquidations(address sponsor)
        external
        view
        nonReentrantView()
        returns (LiquidationData[] memory liquidationData)
    {
        return liquidations[sponsor];
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    function _pfc() internal override view returns (FixedPoint.Unsigned memory) {
        return
            super._pfc().add(
                liquidatableData.rawLiquidationCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier)
            );
    }

    function _getLiquidationData(address sponsor, uint256 liquidationId)
        internal
        view
        returns (LiquidationData storage liquidation)
    {
        LiquidationData[] storage liquidationArray = liquidations[sponsor];

        // Revert if the caller is attempting to access an invalid liquidation
        // (one that has never been created or one has never been initialized).
        require(
            liquidationId < liquidationArray.length && liquidationArray[liquidationId].state != Status.Uninitialized,
            "Invalid liquidation ID"
        );
        return liquidationArray[liquidationId];
    }

    function _getLiquidationExpiry(LiquidationData storage liquidation) internal view returns (uint256) {
        return liquidation.liquidationTime.add(liquidatableData.liquidationLiveness);
    }

    // These internal functions are supposed to act identically to modifiers, but re-used modifiers
    // unnecessarily increase contract bytecode size.
    // source: https://blog.polymath.network/solidity-tips-and-tricks-to-save-gas-and-reduce-bytecode-size-c44580b218e6
    function _disputable(uint256 liquidationId, address sponsor) internal view {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, liquidationId);
        require(
            (getCurrentTime() < _getLiquidationExpiry(liquidation)) && (liquidation.state == Status.PreDispute),
            "Liquidation not disputable"
        );
    }

    function _withdrawable(uint256 liquidationId, address sponsor) internal view {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, liquidationId);
        Status state = liquidation.state;

        // Must be disputed or the liquidation has passed expiry.
        require(
            (state > Status.PreDispute) ||
                ((_getLiquidationExpiry(liquidation) <= getCurrentTime()) && (state == Status.PreDispute)),
            "Liquidation not withdrawable"
        );
    }
}
