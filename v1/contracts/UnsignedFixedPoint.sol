pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title Library for fixed point arithmetic on uints
 * TODO(ptare): Add operations against non-fixed point number, e.g., add(FixedPointUint, uint).
 */
library UnsignedFixedPoint {

    using SafeMath for uint;

    // Supports 18 decimals. E.g., 1e18 represents "1", 5e17 represents "0.5".
    // Can represent a value up to (2^256 - 1)/10^18 = ~10^59.
    uint private constant FP_SCALING_FACTOR = 10**18;

    struct FixedPointUint {
        uint value;
    }

    /** @dev Adds two `FixedPointUint`s, reverting on overflow. */
    function add(FixedPointUint memory a, FixedPointUint memory b) internal pure returns (FixedPointUint memory) {
        return FixedPointUint(a.value.add(b.value));
    }

    /** @dev Subtracts two `FixedPointUint`s, reverting on underflow. */
    function sub(FixedPointUint memory a, FixedPointUint memory b) internal pure returns (FixedPointUint memory) {
        return FixedPointUint(a.value.sub(b.value));
    }

    /** @dev Multiplies two `FixedPointUint`s, reverting on overflow. */
    function mul(FixedPointUint memory a, FixedPointUint memory b) internal pure returns (FixedPointUint memory) {
        // There are two caveats with this computation:
        // 1. Max output is ~10^41 (vs ~10^59 as the max value that can be represented), otherwise an intermediate value
        // overflows.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 1.4 * 2e-18 = 2.8e-18, which
        // would round to 3, but this computation produces the result 2.
        // No need to use SafeMath because FP_SCALING_FACTOR != 0.
        return FixedPointUint(a.value.mul(b.value) / FP_SCALING_FACTOR);
    }

    /** @dev Divides with truncation two `FixedPointUint`s, reverting on overflow or division by 0. */
    function div(FixedPointUint memory a, FixedPointUint memory b) internal pure returns (FixedPointUint memory) {
        // There are two caveats with this computation:
        // 1. Max value for the dividend `a` is ~10^41, otherwise an intermediate value overflows.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 2 / 3 = 0.6 repeating, which
        // would round to 0.666666666666666667, but this computation produces the result 0.666666666666666666.
        return FixedPointUint(a.value.mul(FP_SCALING_FACTOR).div(b.value));
    }
}
