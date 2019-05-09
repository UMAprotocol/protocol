pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title Library for fixed point arithmetic on uints
 * TODO(ptare): Add operations against non-fixed point number, e.g., add(Unsigned, uint).
 */
library FixedPoint {

    using SafeMath for uint;

    // Supports 18 decimals. E.g., 1e18 represents "1", 5e17 represents "0.5".
    // Can represent a value up to (2^256 - 1)/10^18 = ~10^59. 10^59 will be stored internally as uint 10^77.
    uint private constant FP_SCALING_FACTOR = 10**18;

    struct Unsigned {
        uint value;
    }

    /** @dev Adds two `Unsigned`s, reverting on overflow. */
    function add(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return Unsigned(a.value.add(b.value));
    }

    /** @dev Subtracts two `Unsigned`s, reverting on underflow. */
    function sub(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        return Unsigned(a.value.sub(b.value));
    }

    /** @dev Multiplies two `Unsigned`s, reverting on overflow. */
    function mul(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        // There are two caveats with this computation:
        // 1. Max output for the represented number is ~10^41, otherwise an intermediate value overflows. 10^41 is
        // stored internally as a uint ~10^59.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 1.4 * 2e-18 = 2.8e-18, which
        // would round to 3, but this computation produces the result 2.
        // No need to use SafeMath because FP_SCALING_FACTOR != 0.
        return Unsigned(a.value.mul(b.value) / FP_SCALING_FACTOR);
    }

    /** @dev Divides with truncation two `Unsigned`s, reverting on overflow or division by 0. */
    function div(Unsigned memory a, Unsigned memory b) internal pure returns (Unsigned memory) {
        // There are two caveats with this computation:
        // 1. Max value for the number dividend `a` represents is ~10^41, otherwise an intermediate value overflows.
        // 10^41 is stored internally as a uint 10^59.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 2 / 3 = 0.6 repeating, which
        // would round to 0.666666666666666667, but this computation produces the result 0.666666666666666666.
        return Unsigned(a.value.mul(FP_SCALING_FACTOR).div(b.value));
    }
}
