pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../FixedPoint.sol";
import "../Finder.sol";
import "../Testable.sol";

contract FeePayer is Testable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    
    IERC20 public collateralCurrency;
    Finder public finder;
    uint lastPaymentTime;

    modifier fees {
        payFees();
        _;
    }

    constructor(address collateralAddress, address finderAddress, bool _isTest) public Testable(_isTest) {
        collateralCurrency = IERC20(collateralAddress);
        finder = Finder(finderAddress);
        lastPaymentTime = getCurrentTime();
    }

    function payFees() public returns (FixedPoint.Unsigned memory totalPaid) {
        StoreInterface store = StoreInterface(finder.getImplementationAddress("Store"));
        uint currentTime = getCurrentTime();
        (FixedPoint.Unsigned memory regularFee, FixedPoint.Unsigned memory latePenalty) = store.computeRegularFee(
            lastPaymentTime,
            currentTime,
            pfc()
        );
        lastPaymentTime = currentTime;

        if (regularFee.isGreaterThan(0)) {
            collateralCurrency.approve(address(store), regularFee.rawValue);
            store.payOracleFeesErc20(address(collateralCurrency));
        }

        if (latePenalty.isGreaterThan(0)) {
            collateralCurrency.transfer(msg.sender, latePenalty.rawValue);
        }

        return regularFee.add(latePenalty);
    }

    function pfc() public returns (FixedPoint.Unsigned memory);
}
