pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title Library for fixed point arithmetic on uints
 */
library UnsignedFixedPoint {

    using SafeMath for uint;

    // Supports 18 decimals. E.g., 1e18 represents "1", 5e17 represents "0.5".
    uint private constant FP_SCALING_FACTOR = 10**18;

    struct FixedPointUint {
        uint value;
    }

    function add(FixedPointUint memory a, FixedPointUint memory b) internal pure returns (FixedPointUint memory) {
        return FixedPointUint(a.value.add(b.value));
    }

    function sub(FixedPointUint memory a, FixedPointUint memory b) internal pure returns (FixedPointUint memory) {
        return FixedPointUint(a.value.sub(b.value));
    }

    function mul(FixedPointUint memory a, FixedPointUint memory b) internal pure returns (FixedPointUint memory) {
        // There are two caveats with this computation:
        // 1. Max output is 2^238 (i.e., 2^(256-18)), otherwise an intermediate value overflows.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 1.4 * 2e-18 = 2.8e-18, which
        // would round to 3, but this computation produces the result 2.
        // No need to use SafeMath because FP_SCALING_FACTOR != 0.
        return FixedPointUint(a.value.mul(b.value) / FP_SCALING_FACTOR);
    }

    function div(FixedPointUint memory a, FixedPointUint memory b) internal pure returns (FixedPointUint memory) {
        // There are two caveats with this computation:
        // 1. Max value for the dividend `a` is 2^238 (i.e., 2^(256-18)), otherwise an intermediate value overflows.
        // 2. Results that can't be represented exactly are truncated not rounded. E.g., 2 / 3 = 0.6 repeating, which
        // would round to 0.666666666666666667, but this computation produces the result 0.666666666666666666.
        return FixedPointUint(a.value.mul(FP_SCALING_FACTOR).div(b.value));
    }
}
