pragma solidity ^0.5.0;

import "../FixedPoint.sol";

// Wraps the FixedPoint library for testing purposes.
contract FixedPointTest {
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;
    using SafeMath for uint;

    function wrapFromUnscaledUint(uint a) external pure returns (uint) {
        return FixedPoint.fromUnscaledUint(a).rawValue;
    }

    function wrapIsEqual(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isEqual(FixedPoint.Unsigned(b));
    }

    function wrapMixedIsEqual(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isEqual(b);
    }

    function wrapIsGreaterThan(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isGreaterThan(FixedPoint.Unsigned(b));
    }

    function wrapIsGreaterThanOrEqual(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isGreaterThanOrEqual(FixedPoint.Unsigned(b));
    }

    function wrapMixedIsGreaterThan(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isGreaterThan(b);
    }

    function wrapMixedIsGreaterThanOrEqual(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isGreaterThanOrEqual(b);
    }

    function wrapMixedIsGreaterThanOpposite(uint a, uint b) external pure returns (bool) {
        return a.isGreaterThan(FixedPoint.Unsigned(b));
    }

    function wrapMixedIsGreaterThanOrEqualOpposite(uint a, uint b) external pure returns (bool) {
        return a.isGreaterThanOrEqual(FixedPoint.Unsigned(b));
    }

    function wrapIsLessThan(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isLessThan(FixedPoint.Unsigned(b));
    }

    function wrapIsLessThanOrEqual(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isLessThanOrEqual(FixedPoint.Unsigned(b));
    }

    function wrapMixedIsLessThan(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isLessThan(b);
    }

    function wrapMixedIsLessThanOrEqual(uint a, uint b) external pure returns (bool) {
        return FixedPoint.Unsigned(a).isLessThanOrEqual(b);
    }

    function wrapMixedIsLessThanOpposite(uint a, uint b) external pure returns (bool) {
        return a.isLessThan(FixedPoint.Unsigned(b));
    }

    function wrapMixedIsLessThanOrEqualOpposite(uint a, uint b) external pure returns (bool) {
        return a.isLessThanOrEqual(FixedPoint.Unsigned(b));
    }

    function wrapAdd(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).add(FixedPoint.Unsigned(b)).rawValue;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedAdd(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).add(b).rawValue;
    }

    function wrapSub(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).sub(FixedPoint.Unsigned(b)).rawValue;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedSub(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).sub(b).rawValue;
    }

    // The second uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedSubOpposite(uint a, uint b) external pure returns (uint) {
        return a.sub(FixedPoint.Unsigned(b)).rawValue;
    }

    function wrapMul(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).mul(FixedPoint.Unsigned(b)).rawValue;
    }

    function wrapMulCeil(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).mulCeil(FixedPoint.Unsigned(b)).rawValue;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedMul(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).mul(b).rawValue;
    }

    function wrapMixedMulCeil(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).mulCeil(b).rawValue;
    }

    function wrapDiv(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).div(FixedPoint.Unsigned(b)).rawValue;
    }

    function wrapDivCeil(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).divCeil(FixedPoint.Unsigned(b)).rawValue;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedDiv(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).div(b).rawValue;
    }

    function wrapMixedDivCeil(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).divCeil(b).rawValue;
    }

    // The second uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedDivOpposite(uint a, uint b) external pure returns (uint) {
        return a.div(FixedPoint.Unsigned(b)).rawValue;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapPow(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).pow(b).rawValue;
    }
}
