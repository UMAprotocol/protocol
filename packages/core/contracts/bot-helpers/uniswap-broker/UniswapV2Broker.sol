// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import "@uniswap/lib/contracts/libraries/Babylonian.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

/**
 * @title UniswapV2Broker
 * @notice Trading contract used to arb uniswap pairs to a desired "true" price. Intended use is to arb UMA perpetual
 * synthetics that trade off peg. This implementation can ber used in conjunction with a DSProxy contract to atomically
 * swap and move a uniswap market.
 */

contract UniswapV2Broker {
    using SafeMath for uint256;

    /**
     * @notice Swaps an amount of either token such that the trade results in the uniswap pair's price being as close as
     * possible to the truePrice.
     * @dev True price is expressed in the ratio of token A to token B.
     * @dev The caller must approve this contract to spend whichever token is intended to be swapped.
     * @param tradingAsEOA bool to indicate if the UniswapV2Broker is being called by a DSProxy or an EOA.
     * @param uniswapRouter address of the uniswap router used to facilitate trades.
     * @param uniswapFactory address of the uniswap factory used to fetch current pair reserves.
     * @param swappedTokens array of addresses which are to be swapped. The order does not matter as the function will figure
     * out which tokens need to be exchanged to move the market to the desired "true" price.
     * @param truePriceTokens array of unit used to represent the true price. 0th value is the numerator of the true price
     * and the 1st value is the the denominator of the true price.
     * @param maxSpendTokens array of unit to represent the max to spend in the two tokens.
     * @param to recipient of the trade proceeds.
     * @param deadline to limit when the trade can execute. If the tx is mined after this timestamp then revert.
     */
    function swapToPrice(
        bool tradingAsEOA,
        address uniswapRouter,
        address uniswapFactory,
        address[2] memory swappedTokens,
        uint256[2] memory truePriceTokens,
        uint256[2] memory maxSpendTokens,
        address to,
        uint256 deadline
    ) public {
        IUniswapV2Router01 router = IUniswapV2Router01(uniswapRouter);

        // true price is expressed as a ratio, so both values must be non-zero
        require(truePriceTokens[0] != 0 && truePriceTokens[1] != 0, "SwapToPrice: ZERO_PRICE");
        // caller can specify 0 for either if they wish to swap in only one direction, but not both
        require(maxSpendTokens[0] != 0 || maxSpendTokens[1] != 0, "SwapToPrice: ZERO_SPEND");

        bool aToB;
        uint256 amountIn;
        {
            (uint256 reserveA, uint256 reserveB) = getReserves(uniswapFactory, swappedTokens[0], swappedTokens[1]);
            (aToB, amountIn) = computeTradeToMoveMarket(truePriceTokens[0], truePriceTokens[1], reserveA, reserveB);
        }

        require(amountIn > 0, "SwapToPrice: ZERO_AMOUNT_IN");

        // spend up to the allowance of the token in
        uint256 maxSpend = aToB ? maxSpendTokens[0] : maxSpendTokens[1];
        if (amountIn > maxSpend) {
            amountIn = maxSpend;
        }

        address tokenIn = aToB ? swappedTokens[0] : swappedTokens[1];
        address tokenOut = aToB ? swappedTokens[1] : swappedTokens[0];

        TransferHelper.safeApprove(tokenIn, address(router), amountIn);

        if (tradingAsEOA) TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        router.swapExactTokensForTokens(
            amountIn,
            0, // amountOutMin: we can skip computing this number because the math is tested within the uniswap tests.
            path,
            to,
            deadline
        );
    }

    /**
     * @notice Given the "true" price a token (represented by truePriceTokenA/truePriceTokenB) and the reservers in the
     * uniswap pair, calculate: a) the direction of trade (aToB) and b) the amount needed to trade (amountIn) to move
     * the pool price to be equal to the true price.
     * @dev Note that this method uses the Babylonian square root method which has a small margin of error which will
     * result in a small over or under estimation on the size of the trade needed.
     * @param truePriceTokenA the nominator of the true price.
     * @param truePriceTokenB the denominator of the true price.
     * @param reserveA number of token A in the pair reserves
     * @param reserveB number of token B in the pair reserves
     */
    //
    function computeTradeToMoveMarket(
        uint256 truePriceTokenA,
        uint256 truePriceTokenB,
        uint256 reserveA,
        uint256 reserveB
    ) public pure returns (bool aToB, uint256 amountIn) {
        aToB = FullMath.mulDiv(reserveA, truePriceTokenB, reserveB) < truePriceTokenA;

        uint256 invariant = reserveA.mul(reserveB);

        // The trade ∆a of token a required to move the market to some desired price P' from the current price P can be
        // found with ∆a=(kP')^1/2-Ra.
        uint256 leftSide =
            Babylonian.sqrt(
                FullMath.mulDiv(
                    invariant,
                    aToB ? truePriceTokenA : truePriceTokenB,
                    aToB ? truePriceTokenB : truePriceTokenA
                )
            );
        uint256 rightSide = (aToB ? reserveA : reserveB);

        if (leftSide < rightSide) return (false, 0);

        // compute the amount that must be sent to move the price back to the true price.
        amountIn = leftSide.sub(rightSide);
    }

    // The methods below are taken from https://github.com/Uniswap/uniswap-v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol
    // We could import this library into this contract but this library is dependent Uniswap's SafeMath, which is bound
    // to solidity 6.6.6. UMA uses 0.8.0 and so a modified version is needed to accomidate this solidity version.
    function getReserves(
        address factory,
        address tokenA,
        address tokenB
    ) public view returns (uint256 reserveA, uint256 reserveB) {
        (address token0, ) = sortTokens(tokenA, tokenB);
        (uint256 reserve0, uint256 reserve1, ) = IUniswapV2Pair(pairFor(factory, tokenA, tokenB)).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, "UniswapV2Library: IDENTICAL_ADDRESSES");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "UniswapV2Library: ZERO_ADDRESS");
    }

    // calculates the CREATE2 address for a pair without making any external calls
    function pairFor(
        address factory,
        address tokenA,
        address tokenB
    ) internal pure returns (address pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        pair = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            factory,
                            keccak256(abi.encodePacked(token0, token1)),
                            hex"96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f" // init code hash
                        )
                    )
                )
            )
        );
    }
}

// The library below is taken from @uniswap/lib/contracts/libraries/FullMath.sol. It has been modified to work with solidity 0.8
library FullMath {
    /// @notice Calculates floor(a×b÷denominator) with full precision. Throws if result overflows a uint256 or denominator == 0
    /// @param a The multiplicand
    /// @param b The multiplier
    /// @param denominator The divisor
    /// @return result The 256-bit result
    /// @dev Credit to Remco Bloemen under MIT license https://xn--2-umb.com/21/muldiv
    function mulDiv(
        uint256 a,
        uint256 b,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        // 512-bit multiply [prod1 prod0] = a * b
        // Compute the product mod 2**256 and mod 2**256 - 1
        // then use the Chinese Remainder Theorem to reconstruct
        // the 512 bit result. The result is stored in two 256
        // variables such that product = prod1 * 2**256 + prod0
        uint256 prod0; // Least significant 256 bits of the product
        uint256 prod1; // Most significant 256 bits of the product
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }

        // Handle non-overflow cases, 256 by 256 division
        if (prod1 == 0) {
            require(denominator > 0);
            assembly {
                result := div(prod0, denominator)
            }
            return result;
        }

        // Make sure the result is less than 2**256.
        // Also prevents denominator == 0
        require(denominator > prod1);

        ///////////////////////////////////////////////
        // 512 by 256 division.
        ///////////////////////////////////////////////

        // Make division exact by subtracting the remainder from [prod1 prod0]
        // Compute remainder using mulmod
        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, denominator)
        }
        // Subtract 256 bit number from 512 bit number
        assembly {
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }

        // Factor powers of two out of denominator
        // Compute largest power of two divisor of denominator.
        // Always >= 1.
        uint256 twos = denominator & (~denominator + 1);
        // Divide denominator by power of two
        assembly {
            denominator := div(denominator, twos)
        }

        // Divide [prod1 prod0] by the factors of two
        assembly {
            prod0 := div(prod0, twos)
        }
        // Shift in bits from prod1 into prod0. For this we need
        // to flip `twos` such that it is 2**256 / twos.
        // If twos is zero, then it becomes one
        assembly {
            twos := add(div(sub(0, twos), twos), 1)
        }
        prod0 |= prod1 * twos;

        // Invert denominator mod 2**256
        // Now that denominator is an odd number, it has an inverse
        // modulo 2**256 such that denominator * inv = 1 mod 2**256.
        // Compute the inverse by starting with a seed that is correct
        // correct for four bits. That is, denominator * inv = 1 mod 2**4
        uint256 inv = (3 * denominator) ^ 2;
        // Now use Newton-Raphson iteration to improve the precision.
        // Thanks to Hensel's lifting lemma, this also works in modular
        // arithmetic, doubling the correct bits in each step.
        inv *= 2 - denominator * inv; // inverse mod 2**8
        inv *= 2 - denominator * inv; // inverse mod 2**16
        inv *= 2 - denominator * inv; // inverse mod 2**32
        inv *= 2 - denominator * inv; // inverse mod 2**64
        inv *= 2 - denominator * inv; // inverse mod 2**128
        inv *= 2 - denominator * inv; // inverse mod 2**256

        // Because the division is now exact we can divide by multiplying
        // with the modular inverse of denominator. This will give us the
        // correct result modulo 2**256. Since the precoditions guarantee
        // that the outcome is less than 2**256, this is the final result.
        // We don't need to compute the high bits of the result and prod1
        // is no longer required.
        result = prod0 * inv;
        return result;
    }

    /// @notice Calculates ceil(a×b÷denominator) with full precision. Throws if result overflows a uint256 or denominator == 0
    /// @param a The multiplicand
    /// @param b The multiplier
    /// @param denominator The divisor
    /// @return result The 256-bit result
    function mulDivRoundingUp(
        uint256 a,
        uint256 b,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        result = mulDiv(a, b, denominator);
        if (mulmod(a, b, denominator) > 0) {
            require(result < type(uint256).max);
            result++;
        }
    }
}
