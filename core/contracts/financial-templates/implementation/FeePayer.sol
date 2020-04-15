pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";
import "../../oracle/interfaces/StoreInterface.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/InterfaceRegistry.sol";


/**
 * @title FeePayer contract.
 * @notice Provides fee payment functionality for the ExpiringMultiParty contract.
 * contract is abstract as each derived contract that inherits `FeePayer` must implement `pfc()`.
 */

abstract contract FeePayer is Testable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    /****************************************
     *      FEE PAYER DATA STRUCTURES       *
     ****************************************/

    // The collateral currency used to back the positions in this contract.
    IERC20 public collateralCurrency;

    //  Finder contract used to look up addresses for UMA system contracts.
    FinderInterface public finder;

    // Tracks the last block time when the fees were paid.
    uint public lastPaymentTime;

    // Tracks the cumulative fees that have been paid by the contract for use by derived contracts.
    // The multiplier starts at 1, and is updated by computing cumulativeFeeMultiplier * (1 - effectiveFee).
    // Put another way, the cumulativeFeeMultiplier is (1 - effectiveFee1) * (1 - effectiveFee2) ...
    // For example:
    // The cumulativeFeeMultiplier should start at 1.
    // If a 1% fee is charged, the multiplier should update to .99.
    // If another 1% fee is charged, the multiplier should be 0.99^2 (0.9801).
    FixedPoint.Unsigned public cumulativeFeeMultiplier;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event RegularFeesPaid(uint indexed regularFee, uint indexed lateFee);
    event FinalFeesPaid(uint indexed amount);

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    // modifier that calls payFees().
    modifier fees {
        payFees();
        _;
    }

    /**
     * @notice Constructs the FeePayer contract. Called by child contracts.
     * @param collateralAddress ERC20 token that is used as the underlying collateral for the synthetic.
     * @param finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param isTest whether this contract is being constructed for the purpose of running tests.
     */
    constructor(address collateralAddress, address finderAddress, bool isTest) public Testable(isTest) {
        collateralCurrency = IERC20(collateralAddress);
        finder = FinderInterface(finderAddress);
        lastPaymentTime = getCurrentTime();
        cumulativeFeeMultiplier = FixedPoint.fromUnscaledUint(1);
    }

    /****************************************
     *        FEE PAYMENT FUNCTIONS         *
     ****************************************/

    /**
     * @notice Pays UMA DVM regular fees to the Store contract.
     * @dev These must be paid periodically for the life of the contract. If the contract has not paid its
     * regular fee in a week or mre then a late penalty is applied which is sent to the caller.
     * @return totalPaid The amount of collateral that the contract paid (sum of the amount paid to the Store and the caller).
     */
    function payFees() public returns (FixedPoint.Unsigned memory totalPaid) {
        StoreInterface store = _getStore();
        uint time = getCurrentTime();
        FixedPoint.Unsigned memory _pfc = pfc();

        // Exit early if there is no pfc (thus, no fees to be paid).
        if (_pfc.isEqual(0)) {
            return totalPaid;
        }

        (FixedPoint.Unsigned memory regularFee, FixedPoint.Unsigned memory latePenalty) = store.computeRegularFee(
            lastPaymentTime,
            time,
            _pfc
        );
        lastPaymentTime = time;

        if (regularFee.isGreaterThan(0)) {
            collateralCurrency.safeIncreaseAllowance(address(store), regularFee.rawValue);
            store.payOracleFeesErc20(address(collateralCurrency));
        }

        if (latePenalty.isGreaterThan(0)) {
            collateralCurrency.safeTransfer(msg.sender, latePenalty.rawValue);
        }

        emit RegularFeesPaid(regularFee.rawValue, latePenalty.rawValue);

        totalPaid = regularFee.add(latePenalty);
        FixedPoint.Unsigned memory effectiveFee = totalPaid.divCeil(_pfc);
        cumulativeFeeMultiplier = cumulativeFeeMultiplier.mul(FixedPoint.fromUnscaledUint(1).sub(effectiveFee));
    }

    /**
     * @notice Pays UMA DVM final fees to the Store contract.
     * @dev This is a flat fee charged for each price request.
     * @param payer address of who is paying the fees.
     * @param amount the amount of collateral to send as the final fee.
     */
    function _payFinalFees(address payer, FixedPoint.Unsigned memory amount) internal {
        if (amount.isEqual(0)) {
            return;
        }

        if (payer != address(this)) {
            // If the payer is not the contract pull the collateral from the payer.
            collateralCurrency.safeTransferFrom(payer, address(this), amount.rawValue);
        } else {
            // If the payer is the contract, adjust the cumulativeFeeMultiplier to compensate.
            FixedPoint.Unsigned memory _pfc = pfc();

            // The final fee must be < pfc or the fee will be larger than 100%.
            require(_pfc.isGreaterThan(amount));

            // Add the adjustment.
            FixedPoint.Unsigned memory effectiveFee = amount.divCeil(pfc());
            cumulativeFeeMultiplier = cumulativeFeeMultiplier.mul(FixedPoint.fromUnscaledUint(1).sub(effectiveFee));
        }

        emit FinalFeesPaid(amount.rawValue);

        StoreInterface store = _getStore();
        collateralCurrency.safeIncreaseAllowance(address(store), amount.rawValue);
        store.payOracleFeesErc20(address(collateralCurrency));
    }

    /**
     * @notice Gets the current profit from corruption for this contract in terms of the collateral currency.
     * @dev Derived contracts are expected to implement this function so the payFees()
     * method can correctly compute the owed regular fees.
     */
    function pfc() public virtual view returns (FixedPoint.Unsigned memory);

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(InterfaceRegistry.Store));
    }

    function _computeFinalFees() internal returns (FixedPoint.Unsigned memory finalFees) {
        StoreInterface store = _getStore();
        return store.computeFinalFee(address(collateralCurrency));
    }

    // Returns the user's collateral minus any fees that have been subtracted since it was originally
    // deposited into the contract. Note: if the contract has paid fees since it was deployed, the raw
    // value should be larger than the returned value.
    function _getCollateral(FixedPoint.Unsigned memory rawCollateral)
        internal
        view
        returns (FixedPoint.Unsigned memory collateral)
    {
        return rawCollateral.mul(cumulativeFeeMultiplier);
    }

    // Converts a user-readable collateral value into a raw value that accounts for already-assessed
    // fees. If any fees have been taken from this contract in the past, then the raw value will be
    // larger than the user-readable value.
    function _convertCollateral(FixedPoint.Unsigned memory collateral)
        internal
        view
        returns (FixedPoint.Unsigned memory rawCollateral)
    {
        return collateral.div(cumulativeFeeMultiplier);
    }

    // Decrease rawCollateral by a fee-adjusted collateralToRemove amount. Fee adjustment scales up collateralToRemove
    // by dividing it by cumulativeFeeMutliplier. There is potential for this quotient to be floored, therefore rawCollateral
    // is decreased by less than expected. Because this method is usually called in conjunction with an actual removal of collateral
    // from this contract, return the fee-adjusted amount that the rawCollateral is decreased by so that the caller can
    // minimize error between collateral removed and rawCollateral debited.
    function _removeCollateral(FixedPoint.Unsigned storage rawCollateral, FixedPoint.Unsigned memory collateralToRemove)
        internal
        returns (FixedPoint.Unsigned memory removedCollateral)
    {
        FixedPoint.Unsigned memory initialBalance = _getCollateral(rawCollateral);
        FixedPoint.Unsigned memory adjustedCollateral = _convertCollateral(collateralToRemove);
        rawCollateral.rawValue = rawCollateral.sub(adjustedCollateral).rawValue;
        removedCollateral = initialBalance.sub(_getCollateral(rawCollateral));
    }

    // Increase rawCollateral by a fee-adjusted collateralToRemove amount. Fee adjustment scales up collateralToRemove
    // by dividing it by cumulativeFeeMutliplier. There is potential for this quotient to be floored, therefore rawCollateral
    // is increased by less than expected. Because this method is usually called in conjunction with an actual addition of collateral
    // to this contract, return the fee-adjusted amount that the rawCollateral is increased by so that the caller can
    // minimize error between collateral removed and rawCollateral credited.
    // @dev: This return value exists only for the sake of symmetry with `_removeCollateral`. We don't actually use it because
    // we are OK if more collateral is stored in the contract than is represented by `totalPositionCollateral`.
    function _addCollateral(FixedPoint.Unsigned storage rawCollateral, FixedPoint.Unsigned memory collateralToAdd)
        internal
        returns (FixedPoint.Unsigned memory addedCollateral)
    {
        FixedPoint.Unsigned memory initialBalance = _getCollateral(rawCollateral);
        FixedPoint.Unsigned memory adjustedCollateral = _convertCollateral(collateralToAdd);
        rawCollateral.rawValue = rawCollateral.add(adjustedCollateral).rawValue;
        addedCollateral = _getCollateral(rawCollateral).sub(initialBalance);
    }
}
