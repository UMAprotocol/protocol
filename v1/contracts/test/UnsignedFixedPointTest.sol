pragma solidity ^0.5.0;

import "../UnsignedFixedPoint.sol";


// Wraps the UnsignedFixedPoint library for testing purposes.
contract UnsignedFixedPointTest {
    using UnsignedFixedPoint for UnsignedFixedPoint.FixedPointUint;

    function wrapAdd(uint a, uint b) external view returns (uint) {
        return UnsignedFixedPoint.FixedPointUint(a).add(UnsignedFixedPoint.FixedPointUint(b)).value;
    }

    function wrapSub(uint a, uint b) external view returns (uint) {
        return UnsignedFixedPoint.FixedPointUint(a).sub(UnsignedFixedPoint.FixedPointUint(b)).value;
    }

    function wrapMul(uint a, uint b) external view returns (uint) {
        return UnsignedFixedPoint.FixedPointUint(a).mul(UnsignedFixedPoint.FixedPointUint(b)).value;
    }

    function wrapDiv(uint a, uint b) external view returns (uint) {
        return UnsignedFixedPoint.FixedPointUint(a).div(UnsignedFixedPoint.FixedPointUint(b)).value;
    }
}
