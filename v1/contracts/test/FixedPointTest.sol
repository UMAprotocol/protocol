pragma solidity ^0.5.0;

import "../FixedPoint.sol";


// Wraps the FixedPoint library for testing purposes.
contract FixedPointTest {
    using FixedPoint for FixedPoint.Unsigned;

    function wrapAdd(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).add(FixedPoint.Unsigned(b)).value;
    }

    function wrapSub(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).sub(FixedPoint.Unsigned(b)).value;
    }

    function wrapMul(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).mul(FixedPoint.Unsigned(b)).value;
    }

    function wrapDiv(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).div(FixedPoint.Unsigned(b)).value;
    }
}
