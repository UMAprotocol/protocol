pragma solidity ^0.6.0;

import "./ReturnCalculatorInterface.sol";
import "../common/implementation/Withdrawable.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";


/**
 * @title Computes return values based on a fixed leverage.
 */
contract LeveragedReturnCalculator is ReturnCalculatorInterface, Withdrawable {
    using SignedSafeMath for int256;

    // Leverage value. Negative values return the leveraged short return.
    // Examples:
    // 1 -> unlevered long
    // 2 -> 2x levered long
    // -1 -> unlevered short
    // -2 -> 2x levered short
    int256 internal leverageMultiplier;
    int256 private constant FP_SCALING_FACTOR = 10**18;

    enum Roles { Governance, Withdraw }

    constructor(int256 _leverageMultiplier) public {
        require(_leverageMultiplier != 0);
        leverageMultiplier = _leverageMultiplier;
        _createExclusiveRole(uint256(Roles.Governance), uint256(Roles.Governance), msg.sender);
        _createWithdrawRole(uint256(Roles.Withdraw), uint256(Roles.Governance), msg.sender);
    }

    function computeReturn(int256 oldPrice, int256 newPrice) external override view returns (int256 assetReturn) {
        if (oldPrice == 0) {
            // To avoid a divide-by-zero, just return 0 instead of hitting an exception.
            return 0;
        }

        // Compute the underlying asset return: +1% would be 1.01 (* 1 ether).
        int256 underlyingAssetReturn = newPrice.mul(FP_SCALING_FACTOR).div(oldPrice);

        // Compute the RoR of the underlying asset and multiply by leverageMultiplier to get the modified return.
        assetReturn = underlyingAssetReturn.sub(FP_SCALING_FACTOR).mul(leverageMultiplier);

        // If oldPrice is < 0, we need to flip the sign to keep returns positively correlated with
        // leverageMultiplier * price diffs.
        if (oldPrice < 0) {
            assetReturn = assetReturn.mul(-1);
        }
    }

    function leverage() external override view returns (int256 _leverage) {
        return leverageMultiplier;
    }
}
