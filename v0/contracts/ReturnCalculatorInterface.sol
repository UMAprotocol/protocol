/*
  ReturnCalculator Interface
  The interface that contracts use to compute different modified return structures.
*/
pragma solidity ^0.5.0;


interface ReturnCalculatorInterface {
    // Computes the return between oldPrice and newPrice.
    function computeReturn(int oldPrice, int newPrice) external view returns (int assetReturn);

    // Gets the effective leverage for the return calculator.
    // Note: if this parameter doesn't exist for this calculator, this method should return 1.
    function leverage() external view returns (int _leverage);
}
