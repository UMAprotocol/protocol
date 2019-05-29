pragma solidity ^0.5.0;

import "../FixedPoint.sol";


// Wraps the FixedPoint library for testing purposes.
contract FixedPointTest {
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;
    using SafeMath for uint;

    function wrapFromUnscaledUint(uint a) external pure returns (uint) {
        return FixedPoint.fromUnscaledUint(a).value;
    }

    function wrapIsGreaterThan(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isGreaterThan(FixedPoint.Unsigned(b));
    }

    function wrapMixedIsGreaterThan(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isGreaterThan(b);
    }

    function wrapMixedIsGreaterThanOpposite(uint a, uint b) external pure returns (bool) {
        return a.isGreaterThan(FixedPoint.Unsigned(b));
    }

    function wrapIsLessThan(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isLessThan(FixedPoint.Unsigned(b));
    }

    function wrapMixedIsLessThan(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isLessThan(b);
    }

    function wrapMixedIsLessThanOpposite(uint a, uint b) external pure returns (bool) {
        return a.isLessThan(FixedPoint.Unsigned(b));
    }

    function wrapAdd(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).add(FixedPoint.Unsigned(b)).value;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedAdd(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).add(b).value;
    }

    function wrapSub(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).sub(FixedPoint.Unsigned(b)).value;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedSub(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).sub(b).value;
    }

    // The second uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedSubOpposite(uint a, uint b) external pure returns (uint) {
        return a.sub(FixedPoint.Unsigned(b)).value;
    }

    function wrapMul(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).mul(FixedPoint.Unsigned(b)).value;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedMul(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).mul(b).value;
    }

    function wrapDiv(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).div(FixedPoint.Unsigned(b)).value;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedDiv(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).div(b).value;
    }

    // The second uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedDivOpposite(uint a, uint b) external pure returns (uint) {
        return a.div(FixedPoint.Unsigned(b)).value;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapPow(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).pow(b).value;
    }
}
