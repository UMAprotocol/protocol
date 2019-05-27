/*
  Leveraged Return Calculator.

  Implements a return calculator that applies leverage to the input prices.
*/
pragma solidity ^0.5.0;

import "./ReturnCalculatorInterface.sol";
import "./Withdrawable.sol";
import "openzeppelin-solidity/contracts/drafts/SignedSafeMath.sol";


contract LeveragedReturnCalculator is ReturnCalculatorInterface, Withdrawable {
    using SignedSafeMath for int;

    // Leverage value. Negative values return the leveraged short return.
    // Examples:
    // 1 -> unlevered long
    // 2 -> 2x levered long
    // -1 -> unlevered short
    // -2 -> 2x levered short
    int internal leverageMultiplier;
    int private constant FP_SCALING_FACTOR = 10**18;

    enum Roles {
        Governance,
        Withdraw
    }

    constructor(int _leverageMultiplier) public {
        require(_leverageMultiplier != 0);
        leverageMultiplier = _leverageMultiplier;
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        createWithdrawRole(uint(Roles.Withdraw), uint(Roles.Governance), msg.sender);
    }

    function computeReturn(int oldPrice, int newPrice) external view returns (int assetReturn) {
        if (oldPrice == 0) {
            // To avoid a divide-by-zero, just return 0 instead of hitting an exception.
            return 0;
        }

        // Compute the underlying asset return: +1% would be 1.01 (* 1 ether).
        int underlyingAssetReturn = newPrice.mul(FP_SCALING_FACTOR).div(oldPrice);

        // Compute the RoR of the underlying asset and multiply by leverageMultiplier to get the modified return.
        assetReturn = underlyingAssetReturn.sub(FP_SCALING_FACTOR).mul(leverageMultiplier);


        // If oldPrice is < 0, we need to flip the sign to keep returns positively correlated with
        // leverageMultiplier * price diffs.
        if (oldPrice < 0) {
            assetReturn = assetReturn.mul(-1);
        }
    }

    function leverage() external view returns (int _leverage) {
        return leverageMultiplier;
    }
}
