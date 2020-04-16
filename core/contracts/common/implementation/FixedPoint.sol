pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * @title Library for fixed point arithmetic on uints
 */
library FixedPoint {
    using SafeMath for uint;

    // Supports 18 decimals. E.g., 1e18 represents "1", 5e17 represents "0.5".
    // Can represent a value up to (2^256 - 1)/10^18 = ~10^59. 10^59 will be stored internally as uint256 10^77.
    uint256 private constant FP_SCALING_FACTOR = 10**18;

    struct Unsigned {
        uint256 rawValue;
    }

    /** @dev Constructs an `Unsigned` from an unscaled uint, e.g., `b=5` gets stored internally as `5**18`. */
    function fromUnscaledUint(uint256 a) internal pure returns (Unsigned memory) {
        return Unsigned(a.mul(FP_SCALING_FACTOR));
    }

    /** @dev Whether `a` is equal to `b`. */
    function isEqual(Unsigned memory a, uint256 b) internal pure returns (bool) {
        return a.rawValue == fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is equal to `b`. */
    function isEqual(Unsigned memory a, Unsigned memory b) internal pure returns (bool) {
        return a.rawValue == b.rawValue;
    }

    /** @dev Whether `a` is greater than `b`. */
    function isGreaterThan(Unsigned memory a, Unsigned memory b) internal pure returns (bool) {
        return a.rawValue > b.rawValue;
    }

    /** @dev Whether `a` is greater than `b`. */
    function isGreaterThan(Unsigned memory a, uint256 b) internal pure returns (bool) {
        return a.rawValue > fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is greater than `b`. */
    function isGreaterThan(uint256 a, Unsigned memory b) internal pure returns (bool) {
        return fromUnscaledUint(a).rawValue > b.rawValue;
    }

    /** @dev Whether `a` is greater than or equal to `b`. */
    function isGreaterThanOrEqual(Unsigned memory a, Unsigned memory b) internal pure returns (bool) {
        return a.rawValue >= b.rawValue;
    }

    /** @dev Whether `a` is greater than or equal to `b`. */
    function isGreaterThanOrEqual(Unsigned memory a, uint256 b) internal pure returns (bool) {
        return a.rawValue >= fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is greater than or equal to `b`. */
    function isGreaterThanOrEqual(uint256 a, Unsigned memory b) internal pure returns (bool) {
        return fromUnscaledUint(a).rawValue >= b.rawValue;
    }

    /** @dev Whether `a` is less than `b`. */
    function isLessThan(Unsigned memory a, Unsigned memory b) internal pure returns (bool) {
        return a.rawValue < b.rawValue;
    }

    /** @dev Whether `a` is less than `b`. */
    function isLessThan(Unsigned memory a, uint256 b) internal pure returns (bool) {
        return a.rawValue < fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is less than `b`. */
    function isLessThan(uint256 a, Unsigned memory b) internal pure returns (bool) {
        return fromUnscaledUint(a).rawValue < b.rawValue;
    }

    /** @dev Whether `a` is less than or equal to `b`. */
    function isLessThanOrEqual(Unsigned memory a, Unsigned memory b) internal pure returns (bool) {
        return a.rawValue <= b.rawValue;
    }

    /** @dev Whether `a` is less than or equal to `b`. */
    function isLessThanOrEqual(Unsigned memory a, uint256 b) internal pure returns (bool) {
        return a.rawValue <= fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is less than or equal to `b`. */
    function isLessThanOrEqual(uint256 a, Unsigned memory b) internal pure returns (bool) {
        return fromUnscaledUint(a).rawValue <= b.rawValue;
    }

    /** @dev Returns the min of `a` and `b`. */
    function min(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return a.rawValue < b.rawValue ? a : b;
    }

    /** @dev Returns the max of `a` and `b`. */
    function max(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return a.rawValue > b.rawValue ? a : b;
    }

    /** @dev Adds two `Unsigned`s, reverting on overflow. */
    function add(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return Unsigned(a.rawValue.add(b.rawValue));
    }

    /** @dev Adds an `Unsigned` to an unscaled uint, reverting on overflow. */
    function add(Unsigned memory a, uint256 b) internal pure returns (Unsigned memory) {
        return add(a, fromUnscaledUint(b));
    }

    /** @dev Subtracts two `Unsigned`s, reverting on underflow. */
    function sub(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return Unsigned(a.rawValue.sub(b.rawValue));
    }

    /** @dev Subtracts an unscaled uint256 from an `Unsigned`, reverting on underflow. */
    function sub(Unsigned memory a, uint256 b) internal pure returns (Unsigned memory) {
        return sub(a, fromUnscaledUint(b));
    }

    /** @dev Subtracts an `Unsigned` from an unscaled uint, reverting on underflow. */
    function sub(uint256 a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return sub(fromUnscaledUint(a), b);
    }

    /** @dev Multiplies two `Unsigned`s, reverting on overflow. */
    function mul(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        // There are two caveats with this computation:
        // 1. Max output for the represented number is ~10^41, otherwise an intermediate value overflows. 10^41 is
        // stored internally as a uint256 ~10^59.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 1.4 * 2e-18 = 2.8e-18, which
        // would round to 3, but this computation produces the result 2.
        // No need to use SafeMath because FP_SCALING_FACTOR != 0.
        return Unsigned(a.rawValue.mul(b.rawValue) / FP_SCALING_FACTOR);
    }

    /** @dev Multiplies an `Unsigned` by an unscaled uint, reverting on overflow. */
    function mul(Unsigned memory a, uint256 b) internal pure returns (Unsigned memory) {
        return Unsigned(a.rawValue.mul(b));
    }

    /** @dev Multiplies two `Unsigned`s, reverting on overflow, and ceil's the resultant product rather than the default floor behavior. */
    function mulCeil(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        uint256 mulRaw = a.rawValue.mul(b.rawValue);
        uint256 mulFloor = mulRaw / FP_SCALING_FACTOR;
        uint256 mod = mulRaw.mod(FP_SCALING_FACTOR);
        if (mod != 0) {
            return Unsigned(mulFloor.add(1));
        } else {
            return Unsigned(mulFloor);
        }
    }

    function mulCeil(Unsigned memory a, uint256 b) internal pure returns (Unsigned memory) {
        // Since b is an int, there is no risk of truncation and we can just mul it normally
        return Unsigned(a.rawValue.mul(b));
    }

    /** @dev Divides with truncation two `Unsigned`s, reverting on overflow or division by 0. */
    function div(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        // There are two caveats with this computation:
        // 1. Max value for the number dividend `a` represents is ~10^41, otherwise an intermediate value overflows.
        // 10^41 is stored internally as a uint256 10^59.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 2 / 3 = 0.6 repeating, which
        // would round to 0.666666666666666667, but this computation produces the result 0.666666666666666666.
        return Unsigned(a.rawValue.mul(FP_SCALING_FACTOR).div(b.rawValue));
    }

    /** @dev Divides with truncation an `Unsigned` by an unscaled uint, reverting on division by 0. */
    function div(Unsigned memory a, uint256 b) internal pure returns (Unsigned memory) {
        return Unsigned(a.rawValue.div(b));
    }

    /** @dev Divides with truncation two `Unsigned`s, reverting on overflow or division by 0, and ceil's the resultant product rather than the default floor behavior. */
    function divCeil(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        uint256 aScaled = a.rawValue.mul(FP_SCALING_FACTOR);
        uint256 divFloor = aScaled.div(b.rawValue);
        uint256 mod = aScaled.mod(b.rawValue);
        if (mod != 0) {
            return Unsigned(divFloor.add(1));
        } else {
            return Unsigned(divFloor);
        }
    }

    function divCeil(Unsigned memory a, uint256 b) internal pure returns (Unsigned memory) {
        // Because it is possible that a quotient gets truncated, we can't just call "Unsigned(a.rawValue.div(b))"
        // similarly to mulCeil with a uint256 as the second parameter. Therefore we need to convert b into an Unsigned.
        // This creates the possibility of overflow if b is very large.
        return divCeil(a, fromUnscaledUint(b));
    }

    /** @dev Divides with truncation an unscaled uint256 by an `Unsigned`, reverting on overflow or division by 0. */
    function div(uint256 a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return div(fromUnscaledUint(a), b);
    }

    /** @dev Raises an `Unsigned` to the power of an unscaled uint, reverting on overflow. E.g., `b=2` squares `a`. */
    function pow(Unsigned memory a, uint256 b) internal pure returns (Unsigned memory output) {
        // TODO(ptare): Consider using the exponentiation by squaring technique instead:
        // https://en.wikipedia.org/wiki/Exponentiation_by_squaring
        output = fromUnscaledUint(1);
        for (uint256 i = 0; i < b; i = i.add(1)) {
            output = mul(output, a);
        }
    }
}
