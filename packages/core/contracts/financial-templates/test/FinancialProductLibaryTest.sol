pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "../common/FinancialProductLibrary.sol";


contract FinancialProductLibraryTest is FinancialProductLibrary {
    int256 public scalar;

    constructor(int256 _scalar) public {
        scalar = _scalar;
    }

    function transformPrice(int256 oraclePrice) public override view returns (int256) {
        // Create a simple price transformation that doubles the input number.
        return oraclePrice * scalar;
    }
}
