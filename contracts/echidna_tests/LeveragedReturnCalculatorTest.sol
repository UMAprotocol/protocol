/*
  Leveraged Return Calculator Echidna Tests.
*/
pragma solidity ^0.5.0;

import "../LeveragedReturnCalculator.sol";


contract LeveragedReturnCalculatorTest is LeveragedReturnCalculator {
    // Store in/out for computeReturn().
    int private oldPriceInput;
    int private newPriceInput;
    int private returnOutput;

    // solhint-disable-next-line no-empty-blocks
    constructor(int _leverageMultiplier) public LeveragedReturnCalculator(_leverageMultiplier) {}

    function storeReturn(int oldPrice, int newPrice) external {
        int assetReturn = this.computeReturn(oldPrice, newPrice);
        oldPriceInput = oldPrice;
        newPriceInput = newPrice;
        returnOutput = assetReturn;
    }

    // solhint-disable-next-line func-name-mixedcase
    function echidna_signage() external view returns (bool) {
        if (oldPriceInput == 0) {
            // Special case.
            return returnOutput == 0;
        }

        if (leverageMultiplier >= 1) {
            // Positive leverage means that the price difference should be in the same direction as the return.
            if (newPriceInput >= oldPriceInput) {
                return returnOutput >= 0;
            } else {
                return returnOutput < 0;
            }
        } else if (leverageMultiplier <= -1) {
            // Negative leverage means the price difference should be in the opposite direction of the return.
            if (newPriceInput >= oldPriceInput) {
                return returnOutput <= 0;
            } else {
                return returnOutput > 0;
            }
        } else {
            // Leverage == 0.
            // Should not be possible.
            return false;
        }
    }
}


// Instantiations of different leverage tests.
/* solhint-disable no-empty-blocks, two-lines-top-level-separator */
contract Leveraged1xTest is LeveragedReturnCalculatorTest(1) {}
contract Leveraged4xTest is LeveragedReturnCalculatorTest(4) {}
contract LeveragedShort1xTest is LeveragedReturnCalculatorTest(-1) {}
contract LeveragedShort3xTest is LeveragedReturnCalculatorTest(-3) {}
