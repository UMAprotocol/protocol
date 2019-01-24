/*
  ReturnCalculator Interface
  The interface that contracts use to compute different modified return structures.
*/
pragma solidity ^0.5.0;

interface ReturnCalculatorInterface {
    // Computes the return between oldPrice and newPrice.
    function computeReturn(int oldPrice, int newPrice) external view returns (int assetReturn);
}