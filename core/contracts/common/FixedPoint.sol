pragma solidity ^0.5.0;

import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Library for fixed point arithmetic on uints
 */
library FixedPoint {
    using SafeMath for uint;

    // Supports 18 decimals. E.g., 1e18 represents "1", 5e17 represents "0.5".
    // Can represent a value up to (2^256 - 1)/10^18 = ~10^59. 10^59 will be stored internally as uint 10^77.
    uint private constant FP_SCALING_FACTOR = 10**18;

    struct Unsigned {
        uint rawValue;
    }

    /** @dev Constructs an `Unsigned` from an unscaled uint, e.g., `b=5` gets stored internally as `5**18`. */
    function fromUnscaledUint(uint a) internal pure returns (Unsigned memory) {
        return Unsigned(a.mul(FP_SCALING_FACTOR));
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
    function isGreaterThan(Unsigned memory a, uint b) internal pure returns (bool) {
        return a.rawValue > fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is greater than `b`. */
    function isGreaterThan(uint a, Unsigned memory b) internal pure returns (bool) {
        return fromUnscaledUint(a).rawValue > b.rawValue;
    }

    /** @dev Whether `a` is greater than or equal to `b`. */
    function isGreaterThanOrEqual(Unsigned memory a, Unsigned memory b) internal pure returns (bool) {
        return a.rawValue >= b.rawValue;
    }

    /** @dev Whether `a` is greater than or equal to `b`. */
    function isGreaterThanOrEqual(Unsigned memory a, uint b) internal pure returns (bool) {
        return a.rawValue >= fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is greater than or equal to `b`. */
    function isGreaterThanOrEqual(uint a, Unsigned memory b) internal pure returns (bool) {
        return fromUnscaledUint(a).rawValue >= b.rawValue;
    }

    /** @dev Whether `a` is less than `b`. */
    function isLessThan(Unsigned memory a, Unsigned memory b) internal pure returns (bool) {
        return a.rawValue < b.rawValue;
    }

    /** @dev Whether `a` is less than `b`. */
    function isLessThan(Unsigned memory a, uint b) internal pure returns (bool) {
        return a.rawValue < fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is less than `b`. */
    function isLessThan(uint a, Unsigned memory b) internal pure returns (bool) {
        return fromUnscaledUint(a).rawValue < b.rawValue;
    }

    /** @dev Whether `a` is less than or equal to `b`. */
    function isLessThanOrEqual(Unsigned memory a, Unsigned memory b) internal pure returns (bool) {
        return a.rawValue <= b.rawValue;
    }

    /** @dev Whether `a` is less than or equal to `b`. */
    function isLessThanOrEqual(Unsigned memory a, uint b) internal pure returns (bool) {
        return a.rawValue <= fromUnscaledUint(b).rawValue;
    }

    /** @dev Whether `a` is less than or equal to `b`. */
    function isLessThanOrEqual(uint a, Unsigned memory b) internal pure returns (bool) {
        return fromUnscaledUint(a).rawValue <= b.rawValue;
    }

    /** @dev Adds two `Unsigned`s, reverting on overflow. */
    function add(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return Unsigned(a.rawValue.add(b.rawValue));
    }

    /** @dev Adds an `Unsigned` to an unscaled uint, reverting on overflow. */
    function add(Unsigned memory a, uint b) internal pure returns (Unsigned memory) {
        return add(a, fromUnscaledUint(b));
    }

    /** @dev Subtracts two `Unsigned`s, reverting on underflow. */
    function sub(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return Unsigned(a.rawValue.sub(b.rawValue));
    }

    /** @dev Subtracts an unscaled uint from an `Unsigned`, reverting on underflow. */
    function sub(Unsigned memory a, uint b) internal pure returns (Unsigned memory) {
        return sub(a, fromUnscaledUint(b));
    }

    /** @dev Subtracts an `Unsigned` from an unscaled uint, reverting on underflow. */
    function sub(uint a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return sub(fromUnscaledUint(a), b);
    }

    /** @dev Multiplies two `Unsigned`s, reverting on overflow. */
    function mul(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        // There are two caveats with this computation:
        // 1. Max output for the represented number is ~10^41, otherwise an intermediate value overflows. 10^41 is
        // stored internally as a uint ~10^59.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 1.4 * 2e-18 = 2.8e-18, which
        // would round to 3, but this computation produces the result 2.
        // No need to use SafeMath because FP_SCALING_FACTOR != 0.
        return Unsigned(a.rawValue.mul(b.rawValue) / FP_SCALING_FACTOR);
    }

    /** @dev Multiplies an `Unsigned` by an unscaled uint, reverting on overflow. */
    function mul(Unsigned memory a, uint b) internal pure returns (Unsigned memory) {
        return Unsigned(a.rawValue.mul(b));
    }

    /** @dev Multiplies two `Unsigned`s, reverting on overflow, and ceil's the resultant product rather than the default floor behavior. */
    function mulCeil(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        // To ensure ceiling occurs post-truncation, add 9 of the least significant digit remaining post-truncation
        // (i.e., the 18th digit). If the 19th digit is [1,9], then the 18th digit will get incremented by one and then be correctly
        // ceil'd after truncation.
        return Unsigned(a.rawValue.mul(b.rawValue).add(9 * 10**17) / FP_SCALING_FACTOR);
    }

    function mulCeil(Unsigned memory a, uint b) internal pure returns (Unsigned memory) {
        return mulCeil(a, fromUnscaledUint(b));
    }

    /** @dev Divides with truncation two `Unsigned`s, reverting on overflow or division by 0. */
    function div(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        // There are two caveats with this computation:
        // 1. Max value for the number dividend `a` represents is ~10^41, otherwise an intermediate value overflows.
        // 10^41 is stored internally as a uint 10^59.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 2 / 3 = 0.6 repeating, which
        // would round to 0.666666666666666667, but this computation produces the result 0.666666666666666666.
        return Unsigned(a.rawValue.mul(FP_SCALING_FACTOR).div(b.rawValue));
    }

    /** @dev Divides with truncation an `Unsigned` by an unscaled uint, reverting on division by 0. */
    function div(Unsigned memory a, uint b) internal pure returns (Unsigned memory) {
        return Unsigned(a.rawValue.div(b));
    }

    /** @dev Divides with truncation two `Unsigned`s, reverting on overflow or division by 0, and ceil's the resultant product rather than the default floor behavior. */
    function divCeil(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        // After scaling up a by FP_SCALING_FACTOR, multiply it again by 10 before dividing it by b
        // This leaves the quotient as "one digit too significant", to which we add 9 in its least significant digit,
        // before dividing by 10 which returns the correctly truncated ceil'd number
        return Unsigned(a.rawValue.mul(FP_SCALING_FACTOR.mul(10)).div(b.rawValue).add(9).div(10));
    }

    function divCeil(Unsigned memory a, uint b) internal pure returns (Unsigned memory) {
        return divCeil(a, fromUnscaledUint(b));
    }

    /** @dev Divides with truncation an unscaled uint by an `Unsigned`, reverting on overflow or division by 0. */
    function div(uint a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return div(fromUnscaledUint(a), b);
    }

    /** @dev Raises an `Unsigned` to the power of an unscaled uint, reverting on overflow. E.g., `b=2` squares `a`. */
    function pow(Unsigned memory a, uint b) internal pure returns (Unsigned memory output) {
        // TODO(ptare): Consider using the exponentiation by squaring technique instead:
        // https://en.wikipedia.org/wiki/Exponentiation_by_squaring
        output = fromUnscaledUint(1);
        for (uint i = 0; i < b; i = i.add(1)) {
            output = mul(output, a);
        }
    }
}
