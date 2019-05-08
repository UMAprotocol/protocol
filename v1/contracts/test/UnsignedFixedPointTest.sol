pragma solidity ^0.5.0;

import "../UnsignedFixedPoint.sol";


// Wraps the UnsignedFixedPoint library for testing purposes.
contract UnsignedFixedPointTest {
    using UnsignedFixedPoint for UnsignedFixedPoint.Unsigned;

    function wrapAdd(uint a, uint b) external view returns (uint) {
        return UnsignedFixedPoint.Unsigned(a).add(UnsignedFixedPoint.Unsigned(b)).value;
    }

    function wrapSub(uint a, uint b) external view returns (uint) {
        return UnsignedFixedPoint.Unsigned(a).sub(UnsignedFixedPoint.Unsigned(b)).value;
    }

    function wrapMul(uint a, uint b) external view returns (uint) {
        return UnsignedFixedPoint.Unsigned(a).mul(UnsignedFixedPoint.Unsigned(b)).value;
    }

    function wrapDiv(uint a, uint b) external view returns (uint) {
        return UnsignedFixedPoint.Unsigned(a).div(UnsignedFixedPoint.Unsigned(b)).value;
    }
}
