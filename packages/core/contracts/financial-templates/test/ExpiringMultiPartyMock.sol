pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/implementation/Testable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../common/financial-product-libraries/FinancialProductLibrary.sol";

contract ExpiringMultiPartyMock is Testable {
    using FixedPoint for FixedPoint.Unsigned;

    FinancialProductLibrary public financialProductLibrary;
    uint256 public expirationTimestamp;

    constructor(
        address _financialProductLibraryAddress,
        uint256 _expirationTimestamp,
        address _timerAddress
    ) public Testable(_timerAddress) {
        expirationTimestamp = _expirationTimestamp;
        financialProductLibrary = FinancialProductLibrary(_financialProductLibraryAddress);
    }

    function transformPrice(FixedPoint.Unsigned memory price, uint256 requestTime)
        public
        view
        returns (FixedPoint.Unsigned memory)
    {
        if (address(financialProductLibrary) == address(0)) return price;
        try financialProductLibrary.transformPrice(price, requestTime) returns (
            FixedPoint.Unsigned memory transformedPrice
        ) {
            return transformedPrice;
        } catch {
            return price;
        }
    }
}
