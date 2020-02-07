pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../FixedPoint.sol";
import "../Finder.sol";
import "../Testable.sol";
import "../StoreInterface.sol";

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
    Finder public finder;

    /**
     * Tracks the last block time when the fees were paid.
     */
    uint public lastPaymentTime;

    /**
     * @notice modifier that calls payFees().
     */
    modifier fees {
        payFees();
        _;
    }

    constructor(address collateralAddress, address finderAddress, bool _isTest) public Testable(_isTest) {
        collateralCurrency = IERC20(collateralAddress);
        finder = Finder(finderAddress);
        lastPaymentTime = getCurrentTime();
    }

    /**
     * @notice Pays UMA DVM fees to the Store contract.
     * @return the amount of collateral that was paid to the Store.
     */

    function payFees() public returns (FixedPoint.Unsigned memory totalPaid) {
        StoreInterface store = StoreInterface(finder.getImplementationAddress("Store"));
        uint time = getCurrentTime();
        (FixedPoint.Unsigned memory regularFee, FixedPoint.Unsigned memory latePenalty) = store.computeRegularFee(
            lastPaymentTime,
            time,
            pfc()
        );
        lastPaymentTime = time;

        if (regularFee.isGreaterThan(0)) {
            collateralCurrency.safeIncreaseAllowance(address(store), regularFee.rawValue);
            store.payOracleFeesErc20(address(collateralCurrency));
        }

        if (latePenalty.isGreaterThan(0)) {
            collateralCurrency.safeTransfer(msg.sender, latePenalty.rawValue);
        }

        return regularFee.add(latePenalty);
    }

    /**
     * @notice Gets the current profit from corruption for this contract in terms of the collateral currency.
     * @dev Derived contracts are expected to implement this function so the payFees() method can correctly compute
     * the owed fees.
     */

    function pfc() public view returns (FixedPoint.Unsigned memory);
}
