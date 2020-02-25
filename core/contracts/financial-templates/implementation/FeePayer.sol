pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";
import "../../oracle/interfaces/StoreInterface.sol";
import "../../oracle/interfaces/FinderInterface.sol";


contract FeePayer is Testable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    /**
     * The collateral currency used to back the positions in this contract.
     */

    IERC20 public collateralCurrency;

    /**
     * Finder contract used to look up addresses for UMA system contracts.
     */
    FinderInterface public finder;

    /**
     * Tracks the last block time when the fees were paid.
     */
    uint public lastPaymentTime;

    /**
     * Tracks the cumulative fees that have been paid by the contract for use by derived contracts.
     * The multiplier starts at 1, and is updated by computing cumulativeFeeMultiplier * (1 - effectiveFee).
     * Put another way, the cumulativeFeeMultiplier is (1 - effectiveFee1) * (1 - effectiveFee2) ...
     *
     * For example:
     *
     * The cumulativeFeeMultiplier should start at 1.
     * If a 1% fee is charged, the multiplier should update to .99.
     * If another 1% fee is charged, the multiplier should be 0.99^2 (0.9801).
     */
    FixedPoint.Unsigned public cumulativeFeeMultiplier;

    /**
     * @notice modifier that calls payFees().
     */
    modifier fees {
        payFees();
        _;
    }

    constructor(address collateralAddress, address finderAddress, bool _isTest) public Testable(_isTest) {
        collateralCurrency = IERC20(collateralAddress);
        finder = FinderInterface(finderAddress);
        lastPaymentTime = getCurrentTime();
        cumulativeFeeMultiplier = FixedPoint.fromUnscaledUint(1);
    }

    /**
     * @notice Pays UMA DVM regular fees to the Store contract. These must be paid periodically for the life of the contract.
     * @return the amount of collateral that the contract paid (sum of the amount paid to the store and the caller).
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

        totalPaid = regularFee.add(latePenalty);
        FixedPoint.Unsigned memory effectiveFee = totalPaid.divCeil(_pfc);
        cumulativeFeeMultiplier = cumulativeFeeMultiplier.mul(FixedPoint.fromUnscaledUint(1).sub(effectiveFee));
    }

    /**
     * @notice Pays UMA DVM final fees to the Store contract. This is a flat fee charged for each price request.
     * @return the amount of collateral that was paid to the Store.
     */
    function _payFinalFees(address payer) internal returns (FixedPoint.Unsigned memory totalPaid) {
        StoreInterface store = _getStore();
        totalPaid = store.computeFinalFee(address(collateralCurrency));

        if (totalPaid.isEqual(0)) {
            return totalPaid;
        }

        if (payer != address(this)) {
            // If the payer is not the contract pull the collateral from the payer.
            collateralCurrency.safeTransferFrom(payer, address(this), totalPaid.rawValue);
        } else {
            // If the payer is the contract, adjust the cumulativeFeeMultiplier to compensate.
            FixedPoint.Unsigned memory _pfc = pfc();

            // The final fee must be < pfc or the fee will be larger than 100%.
            require(_pfc.isGreaterThan(totalPaid));

            // Add the adjustment.
            FixedPoint.Unsigned memory effectiveFee = totalPaid.divCeil(pfc());
            cumulativeFeeMultiplier = cumulativeFeeMultiplier.mul(FixedPoint.fromUnscaledUint(1).sub(effectiveFee));
        }

        collateralCurrency.safeIncreaseAllowance(address(store), totalPaid.rawValue);
        store.payOracleFeesErc20(address(collateralCurrency));
    }

    /**
     * @notice Gets the current profit from corruption for this contract in terms of the collateral currency.
     * @dev Derived contracts are expected to implement this function so the payFees() method can correctly compute
     * the owed fees.
     */
    function pfc() public view returns (FixedPoint.Unsigned memory);

    function _getStore() internal view returns (StoreInterface) {
        bytes32 storeInterface = "Store";
        return StoreInterface(finder.getImplementationAddress(storeInterface));
    }

    // The following methods are used by derived classes to interact with collateral that is adjusted by fees.
    function _getCollateral(FixedPoint.Unsigned storage rawCollateral)
        internal
        view
        returns (FixedPoint.Unsigned memory collateral)
    {
        return rawCollateral.mul(cumulativeFeeMultiplier);
    }

    function _removeCollateral(FixedPoint.Unsigned storage rawCollateral, FixedPoint.Unsigned memory collateralToRemove)
        internal
    {
        FixedPoint.Unsigned memory adjustedCollateral = collateralToRemove.div(cumulativeFeeMultiplier);
        rawCollateral.rawValue = rawCollateral.sub(adjustedCollateral).rawValue;
    }

    function _addCollateral(FixedPoint.Unsigned storage rawCollateral, FixedPoint.Unsigned memory collateralToAdd)
        internal
    {
        FixedPoint.Unsigned memory adjustedCollateral = collateralToAdd.div(cumulativeFeeMultiplier);
        rawCollateral.rawValue = rawCollateral.add(adjustedCollateral).rawValue;
    }
}
