pragma solidity ^0.5.0;

import "../FixedPoint.sol";


// Wraps the FixedPoint library for testing purposes.
contract FixedPointTest {
    using FixedPoint for FixedPoint.Unsigned;

    function wrapFromUnscaledUint(uint a) external pure returns (uint) {
        return FixedPoint.fromUnscaledUint(a).value;
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
        return FixedPoint.sub(a, FixedPoint.Unsigned(b)).value;
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
        return FixedPoint.div(a, FixedPoint.Unsigned(b)).value;
    }

    // The first uint is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapPow(uint a, uint b) external pure returns (uint) {
        return FixedPoint.Unsigned(a).pow(b).value;
    }
}
