// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../implementation/FixedPoint.sol";

// Wraps the FixedPoint library for testing purposes.
contract SignedFixedPointTest {
    using FixedPoint for FixedPoint.Signed;
    using FixedPoint for int256;
    using SafeMath for int256;

    function wrapFromSigned(int256 a) external pure returns (uint256) {
        return FixedPoint.fromSigned(FixedPoint.Signed(a)).rawValue;
    }

    function wrapFromUnsigned(uint256 a) external pure returns (int256) {
        return FixedPoint.fromUnsigned(FixedPoint.Unsigned(a)).rawValue;
    }

    function wrapFromUnscaledInt(int256 a) external pure returns (int256) {
        return FixedPoint.fromUnscaledInt(a).rawValue;
    }

    function wrapIsEqual(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isEqual(FixedPoint.Signed(b));
    }

    function wrapMixedIsEqual(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isEqual(b);
    }

    function wrapIsGreaterThan(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isGreaterThan(FixedPoint.Signed(b));
    }

    function wrapIsGreaterThanOrEqual(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isGreaterThanOrEqual(FixedPoint.Signed(b));
    }

    function wrapMixedIsGreaterThan(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isGreaterThan(b);
    }

    function wrapMixedIsGreaterThanOrEqual(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isGreaterThanOrEqual(b);
    }

    function wrapMixedIsGreaterThanOpposite(int256 a, int256 b) external pure returns (bool) {
        return a.isGreaterThan(FixedPoint.Signed(b));
    }

    function wrapMixedIsGreaterThanOrEqualOpposite(int256 a, int256 b) external pure returns (bool) {
        return a.isGreaterThanOrEqual(FixedPoint.Signed(b));
    }

    function wrapIsLessThan(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isLessThan(FixedPoint.Signed(b));
    }

    function wrapIsLessThanOrEqual(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isLessThanOrEqual(FixedPoint.Signed(b));
    }

    function wrapMixedIsLessThan(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isLessThan(b);
    }

    function wrapMixedIsLessThanOrEqual(int256 a, int256 b) external pure returns (bool) {
        return FixedPoint.Signed(a).isLessThanOrEqual(b);
    }

    function wrapMixedIsLessThanOpposite(int256 a, int256 b) external pure returns (bool) {
        return a.isLessThan(FixedPoint.Signed(b));
    }

    function wrapMixedIsLessThanOrEqualOpposite(int256 a, int256 b) external pure returns (bool) {
        return a.isLessThanOrEqual(FixedPoint.Signed(b));
    }

    function wrapMin(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).min(FixedPoint.Signed(b)).rawValue;
    }

    function wrapMax(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).max(FixedPoint.Signed(b)).rawValue;
    }

    function wrapAdd(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).add(FixedPoint.Signed(b)).rawValue;
    }

    // The first int256 is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedAdd(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).add(b).rawValue;
    }

    function wrapSub(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).sub(FixedPoint.Signed(b)).rawValue;
    }

    // The first int256 is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedSub(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).sub(b).rawValue;
    }

    // The second int256 is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedSubOpposite(int256 a, int256 b) external pure returns (int256) {
        return a.sub(FixedPoint.Signed(b)).rawValue;
    }

    function wrapMul(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).mul(FixedPoint.Signed(b)).rawValue;
    }

    function wrapMulAwayFromZero(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).mulAwayFromZero(FixedPoint.Signed(b)).rawValue;
    }

    // The first int256 is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedMul(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).mul(b).rawValue;
    }

    function wrapMixedMulAwayFromZero(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).mulAwayFromZero(b).rawValue;
    }

    function wrapDiv(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).div(FixedPoint.Signed(b)).rawValue;
    }

    function wrapDivAwayFromZero(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).divAwayFromZero(FixedPoint.Signed(b)).rawValue;
    }

    // The first int256 is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedDiv(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).div(b).rawValue;
    }

    function wrapMixedDivAwayFromZero(int256 a, int256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).divAwayFromZero(b).rawValue;
    }

    // The second int256 is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapMixedDivOpposite(int256 a, int256 b) external pure returns (int256) {
        return a.div(FixedPoint.Signed(b)).rawValue;
    }

    // The first int256 is interpreted with a scaling factor and is converted to an `Unsigned` directly.
    function wrapPow(int256 a, uint256 b) external pure returns (int256) {
        return FixedPoint.Signed(a).pow(b).rawValue;
    }
}
