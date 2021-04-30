pragma solidity =0.7.6;
pragma abicoder v2;

import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol";
import "@uniswap/v3-core/contracts/libraries/LiquidityMath.sol";
import "@uniswap/v3-core/contracts/libraries/TickBitmap.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-core/contracts/libraries/SqrtPriceMath.sol";
import "@uniswap/v3-core/contracts/libraries/SafeCast.sol";

/**
 * @title UniswapBrokerV3
 * @notice Trading contract used to arb uniswapV3 pairs to a desired "true" price. Intended use is to arb UMA perpetual
 * synthetics that trade off peg. This implementation can ber used in conjunction with a DSProxy contract to atomically
 * swap and move a uniswap market.
 */

contract UniswapBrokerV3 {
    using SafeCast for uint256;
    using LowGasSafeMath for uint256;
    using LowGasSafeMath for int256;
    using TickBitmap for mapping(int16 => uint256);

    struct SwapState {
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        uint256 requiredInputAmount;
    }

    struct StepComputations {
        uint160 sqrtPriceStartX96;
        int24 tickNext;
        bool initialized;
        uint160 sqrtPriceNextX96;
    }

    /**
     * @notice Swaps an amount of either pool tokens such that the trade results in the uniswap pair's price equaling a
     * desired price.
     * @dev The desired price is represented as sqrtRatioTargetX96. This is the Price^(1/2) * 96^2.
     * @dev The caller must approve this contract to spend whichever token is intended to be swapped.
     * @param tradingAsEOA bool to indicate if the UniswapBroker is being called by a DSProxy or an EOA.
     * @param uniswapPool address of the pool to uniswap v3 trade against.
     * @param uniswapRouter address of the uniswap v3 router to route the trade.
     * @param sqrtRatioTargetX96 target, encoded price.
     * @param recipient address that the output tokens should be sent to.
     * @param deadline to limit when the trade can execute. If the tx is mined after this timestamp then revert.
     */
    function swapToPrice(
        bool tradingAsEOA,
        address uniswapPool,
        address uniswapRouter,
        uint160 sqrtRatioTargetX96,
        address recipient,
        uint256 deadline
    ) external returns (uint256) {
        // Create an instance of the pool and load in the current token price and the active tick.
        IUniswapV3Pool pool = IUniswapV3Pool(uniswapPool);
        (uint160 sqrtPriceX96, int24 tick, , , , , ) = pool.slot0();

        // Work out the direction we need to trade. If the current price is more than the target price then we are
        // trading token0 for token1. Else, we are trading token1 for token0.
        bool zeroForOne = sqrtPriceX96 >= sqrtRatioTargetX96;

        // Fetch the current pool liquditiy. Build a state object to store this information which can be re-used during
        // tick traversal later on.
        uint128 startingLiquidity = pool.liquidity();
        SwapState memory state =
            SwapState({ sqrtPriceX96: sqrtPriceX96, tick: tick, liquidity: pool.liquidity(), requiredInputAmount: 0 });

        // Iterate in a while loop that breaks when we hit the target price.
        while (true) {
            // Compute the next initialized tick. We only need to traverse initalized ticks as uninitalized ticks
            // have the same liquidity as the previous tick.
            StepComputations memory step;
            step.sqrtPriceStartX96 = state.sqrtPriceX96;
            (step.tickNext, step.initialized) = nextInitializedTickWithinOneWord(
                pool,
                state.tick,
                pool.tickSpacing(),
                zeroForOne
            );

            //4.b. Double check we are not over or underflowing the ticks.
            if (step.tickNext < TickMath.MIN_TICK) step.tickNext = TickMath.MIN_TICK;
            else if (step.tickNext > TickMath.MAX_TICK) step.tickNext = TickMath.MAX_TICK;

            // Find the price at the next tick. Between the current state.sqrtPriceX96 and the nextTickPriceX96 we
            // can find how much of the sold token is needed ot sufficiently move the market over the interval.

            uint160 nextTickPriceX96 = TickMath.getSqrtRatioAtTick(step.tickNext);
            uint256 inputAmountForStep;

            // If zeroForOne is true, then we are moving the price UP. In this case we need to ensure that if the next
            // tick price is more than the target price, we set the set the the next step price to the target price. This
            // ensures that the price does not undershoot when the next tick is the last tick. Else, traverse the whole tick.
            if (zeroForOne) {
                step.sqrtPriceNextX96 = nextTickPriceX96 > sqrtRatioTargetX96 ? sqrtRatioTargetX96 : nextTickPriceX96;
                inputAmountForStep = SqrtPriceMath.getAmount0Delta( // As we are trading token0 for token1, calculate the token0 input.
                    step.sqrtPriceStartX96,
                    step.sqrtPriceNextX96,
                    state.liquidity,
                    false
                );
                // Else, if zeroForOne is false, then we are moving the price UP. In this case we need to ensure that we
                // dont overshoot the price on the next step.
            } else if (!zeroForOne) {
                step.sqrtPriceNextX96 = nextTickPriceX96 > sqrtRatioTargetX96 ? nextTickPriceX96 : sqrtRatioTargetX96;
                inputAmountForStep = SqrtPriceMath.getAmount1Delta( // As we are trading token1 for token0, calculate the token1 input.
                    step.sqrtPriceStartX96,
                    step.sqrtPriceNextX96,
                    state.liquidity,
                    false
                );
            }

            // Add amount for this step to the total required input.
            state.requiredInputAmount = state.requiredInputAmount.add(inputAmountForStep);

            // If we have hit(or exceeded) our target price in the associate direction, then stop.
            if (zeroForOne && state.sqrtPriceX96 <= sqrtRatioTargetX96) break;
            if (!zeroForOne && state.sqrtPriceX96 >= sqrtRatioTargetX96) break;

            // If the next step is is initialized then we will need to update the liquidity for the current step.
            if (step.initialized) {
                // Fetch the net liquidity. this could be positive or negative depending on if a LP is turning on or off at this price.
                (, int128 liquidityNet, , ) = pool.ticks(step.tickNext);
                if (!zeroForOne) liquidityNet = -liquidityNet;

                state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
            }

            // Finally, set the state price to the next price for the next iteration.
            state.sqrtPriceX96 = step.sqrtPriceNextX96;
            state.tick = step.tickNext;
        }

        // Based on the direction we are moving, set the input and output tokens.
        address tokenIn = zeroForOne ? pool.token0() : pool.token1();
        address tokenOut = zeroForOne ? pool.token1() : pool.token0();

        // If trading from an EOA pull tokens into this contract. If trading from a DSProxy this is redundant.
        if (tradingAsEOA)
            TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), state.requiredInputAmount);

        // Approve the router and execute the swap.
        TransferHelper.safeApprove(tokenIn, address(uniswapRouter), state.requiredInputAmount);
        ISwapRouter(uniswapRouter).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: pool.fee(),
                recipient: recipient,
                deadline: deadline,
                amountIn: state.requiredInputAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: sqrtRatioTargetX96 + 1
            })
        );

        return state.requiredInputAmount;
    }

    // The two methods below are taken almost verbatim from https://github.com/Uniswap/uniswap-v3-core/blob/main/contracts/libraries/TickBitmap.sol.
    // They was modified slightly to enable the them to be called on an external pool by passing in a pool address.
    function nextInitializedTickWithinOneWord(
        IUniswapV3Pool pool,
        int24 tick,
        int24 tickSpacing,
        bool lte
    ) internal view returns (int24 next, bool initialized) {
        int24 compressed = tick / tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) compressed--; // round towards negative infinity

        if (lte) {
            (int16 wordPos, uint8 bitPos) = position(compressed);
            // all the 1s at or to the right of the current bitPos
            uint256 mask = (1 << bitPos) - 1 + (1 << bitPos);
            uint256 masked = pool.tickBitmap(wordPos) & mask;

            // if there are no initialized ticks to the right of or at the current tick, return rightmost in the word
            initialized = masked != 0;
            // overflow/underflow is possible, but prevented externally by limiting both tickSpacing and tick
            next = initialized
                ? (compressed - int24(bitPos - BitMath.mostSignificantBit(masked))) * tickSpacing
                : (compressed - int24(bitPos)) * tickSpacing;
        } else {
            // start from the word of the next tick, since the current tick state doesn't matter
            (int16 wordPos, uint8 bitPos) = position(compressed + 1);
            // all the 1s at or to the left of the bitPos
            uint256 mask = ~((1 << bitPos) - 1);
            uint256 masked = pool.tickBitmap(wordPos) & mask;

            // if there are no initialized ticks to the left of the current tick, return leftmost in the word
            initialized = masked != 0;
            // overflow/underflow is possible, but prevented externally by limiting both tickSpacing and tick
            next = initialized
                ? (compressed + 1 + int24(BitMath.leastSignificantBit(masked) - bitPos)) * tickSpacing
                : (compressed + 1 + int24(type(uint8).max - bitPos)) * tickSpacing;
        }
    }

    function position(int24 tick) private pure returns (int16 wordPos, uint8 bitPos) {
        wordPos = int16(tick >> 8);
        bitPos = uint8(tick % 256);
    }
}
