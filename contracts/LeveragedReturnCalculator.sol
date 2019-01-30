/*
  Leveraged Return Calculator.

  Implements a return calculator that applies leverage to the input prices.
*/
pragma solidity ^0.5.0;

import "./ReturnCalculatorInterface.sol";
import "openzeppelin-solidity/contracts/drafts/SignedSafeMath.sol";


contract LeveragedReturnCalculator is ReturnCalculatorInterface {
    using SignedSafeMath for int;

    // Leverage value. Negative values return the leveraged short return.
    // Examples:
    // 1 -> unlevered long
    // 2 -> 2x levered long
    // -1 -> unlevered short
    // -2 -> 2x levered short
    int public leverage;

    constructor(int _leverage) public {
        require(_leverage != 0);
        leverage = _leverage;
    }

    function computeReturn(int oldPrice, int newPrice) external view returns (int assetReturn) {
        if (oldPrice == 0) {
            // To avoid a divide-by-zero, just return 0 instead of hitting an exception.
            return 0;
        }

        // Compute the underlying asset return: +1% would be 1.01 (* 1 ether).
        int underlyingAssetReturn = newPrice.mul(1 ether).div(oldPrice);

        // Compute the RoR of the underlying asset and multiply by leverage to get the modified return.
        assetReturn = underlyingAssetReturn.sub(1 ether).mul(leverage);


        // If oldPrice is < 0, we need to flip the sign to keep returns positively correlated with leverage * price
        // diffs.
        if (oldPrice < 0) {
            assetReturn = assetReturn.mul(-1);
        }
    }
}
