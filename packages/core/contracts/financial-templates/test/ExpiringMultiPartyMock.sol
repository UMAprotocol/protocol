pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/implementation/FixedPoint.sol";
import "../common/financial-product-libraries/FinancialProductLibrary.sol";


contract ExpiringMultiPartyMock {
    using FixedPoint for FixedPoint.Unsigned;

    FinancialProductLibrary public financialProductLibrary;
    uint256 public expirationTimestamp;

    constructor(address _financialProductLibraryAddress, uint256 _expirationTimestamp) public {
        expirationTimestamp = _expirationTimestamp;
        financialProductLibrary = FinancialProductLibrary(_financialProductLibraryAddress);
    }

    function transformPrice(FixedPoint.Unsigned memory price) public view returns (FixedPoint.Unsigned memory) {
        if (address(financialProductLibrary) == address(0)) return price;
        try financialProductLibrary.transformPrice(price) returns (FixedPoint.Unsigned memory transformedPrice) {
            return transformedPrice;
        } catch {
            return price;
        }
    }
}
