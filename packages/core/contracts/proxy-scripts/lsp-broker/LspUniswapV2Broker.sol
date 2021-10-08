// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/lib/contracts/libraries/Babylonian.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

import "../../common/implementation/FixedPoint.sol";

import "../../financial-templates/long-short-pair/LongShortPair.sol";

/**
 * @title LspUniswapV2Broker
 * @notice Helper contract to facilitate batched LSP and UniswapV2 transactions, including Mint+Sell and Mint+LP.
 */
contract LspUniswapV2Broker {
    using FixedPoint for FixedPoint.Signed;
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @notice Mint long and short tokens and deposit them all into a UniV2 Pool.
     * @dev The caller of this method needs to approve `amountCollateral` collateral to be spent by this contract.
     * @param callingAsEOA If True, caller has balance of collateral and expects to receive back all LP  tokens + dust.
     * @param longShortPair LSP contract address to mint position on.
     * @param router Contract to call to exchange long and short tokens.
     * @param amountCollateral Amount of collateral to deposit and mint long and short tokens against.
     * @param minLpTokens Minimum number of LP tokens to mint
     * @param deadline Unix timestamp that will force the transaction to revert if minded after this time.
     */
    function atomicMintAddLiquidity(
        bool callingAsEOA,
        LongShortPair longShortPair,
        IUniswapV2Router01 router,
        uint256 amountCollateral,
        uint256 minLpTokens,
        uint256 deadline
    ) public {
        require(address(longShortPair) != address(0), "Invalid long short pair");
        require(address(router) != address(0), "Invalid router");
        require(amountCollateral != 0, "Collateral to mint with");

        IERC20 collateralToken = IERC20(longShortPair.collateralToken());
        IERC20 longToken = IERC20(longShortPair.longToken());
        IERC20 shortToken = IERC20(longShortPair.shortToken());

        // 0) Pull collateral from caller if necessary and approve LSP to spend it.
        if (callingAsEOA)
            TransferHelper.safeTransferFrom(address(collateralToken), msg.sender, address(this), amountCollateral);

        // 1) Approve collateral to be spent by the LSP from this contract at size of amountCollateral.
        TransferHelper.safeApprove(address(collateralToken), address(longShortPair), amountCollateral);

        // 2) Deposit collateral into LSP and mint long and short tokens.
        uint256 tokensToCreate =
            FixedPoint.fromUnscaledUint(amountCollateral).div(longShortPair.collateralPerPair()).rawValue;
        longShortPair.create(tokensToCreate);

        require(
            longToken.balanceOf(address(this)) == shortToken.balanceOf(address(this)) &&
                longToken.balanceOf(address(this)) == tokensToCreate,
            "Create invariant failed"
        );

        {
            // 3) Calculate if we need to sell the long token for the short or the short token for the long. Calculate
            // the total trade size to bring the balance of long/short in this contract to equal the pool ratio after
            // the trade. Note this computation must consider how the resultant pool ratios is impacted by the trade.
            bool aToB;
            uint256 tradeSize;
            (uint256 reserveA, uint256 reserveB) =
                getReserves(router.factory(), address(longToken), address(shortToken));
            (aToB, tradeSize) = computeSwapToMintAtPoolRatio(
                FixedPoint.Signed(int256(tokensToCreate)),
                FixedPoint.Signed(int256(reserveA)),
                FixedPoint.Signed(int256(reserveB))
            );
            address[] memory path = new address[](2);

            // 3.a) If the trade is token a to b then we are selling long tokens for short tokens. In this case, we
            // know the exact output number of tokens we want (short tokens) and use the router's
            // swapTokensForExactTokens with the exact output number of tokens specified.
            if (aToB && tradeSize > 0) {
                path[0] = address(longToken);
                path[1] = address(shortToken);
                TransferHelper.safeApprove(address(longToken), address(router), tradeSize);
                router.swapTokensForExactTokens(tradeSize, type(uint256).max, path, address(this), deadline);
            }
            if (!aToB && tradeSize > 0) {
                // Else, if the trade is b to a then we are selling short tokens for long tokens. In this case, we
                // know the exact input number of tokens that we need to sell (short tokens) and can use the router's
                // swapExactTokensForTokens with the exact input specified.
                path[0] = address(shortToken);
                path[1] = address(longToken);
                TransferHelper.safeApprove(address(shortToken), address(router), tradeSize);
                router.swapExactTokensForTokens(tradeSize, 0, path, address(this), deadline);
            }
        }

        // 4) Add liquidity to the pool via the router. Approve both long and short tokens with the full account balance
        // in this contract (i.e the amount of tokens minted +- that traded in step 2.).
        TransferHelper.safeApprove(address(longToken), address(router), longToken.balanceOf(address(this)));
        TransferHelper.safeApprove(address(shortToken), address(router), shortToken.balanceOf(address(this)));
        router.addLiquidity(
            address(longToken),
            address(shortToken),
            longToken.balanceOf(address(this)),
            shortToken.balanceOf(address(this)),
            0,
            0,
            address(this),
            deadline
        );

        // 5) Validate that at least the minimum number of tokens have been minted. If not, revert.
        {
            IERC20 lPToken = IERC20(address(pairFor(router.factory(), address(longToken), address(shortToken))));
            require(lPToken.balanceOf(address(this)) > minLpTokens, "Failed to mint min LP tokens");

            // 5) Finally, if the caller is an EOA, send back the LP tokens from minting + any dust that was left over.
            // The dust is in the long and short tokens and will be left over as a result of small rounding errors in
            // the calculation on how many long/short should be bought/sold to meet the pool ratio before minting.
            if (callingAsEOA) {
                // Send the LP tokens back to the minter.
                TransferHelper.safeTransfer(address(lPToken), msg.sender, lPToken.balanceOf(address(this)));

                // Send any dust left over back to the minter that may have happened due to small rounding errors in
                // the computation methods within computeSwapToMintAtPoolRatio.
                TransferHelper.safeTransfer(address(longToken), msg.sender, longToken.balanceOf(address(this)));
                TransferHelper.safeTransfer(address(shortToken), msg.sender, shortToken.balanceOf(address(this)));
            }
        }
    }

    // For a given mint size (m) and pool balances (ra & rb), compute the trade size such that the resulting ratio
    // of tokens, considering the mint and trade,is equal to the pool ratio after the trade. This is computed using the
    // following logic: Assume m tokens are minted in equal proportion of long and short. This contract will therefore
    // hold t_l=m+△l long tokens and t_s=m-△s after a trade of s for l tokens. The ratio t_l/t_s must equal the pool
    // ratio after the trade. The pool ratio, considering the trade can be expressed as (R_a-△a)(R_b+△bλ)=k for a
    // trade of △a for △b and a swap fee of λ=(1-swapFee). Using this, with a bit of algebra and simplification, we can
    // solve for the resultant ratio to be (m+△a)/(m-△b)=(R_a-△a)/(R_b+△b). i.e the ratio of mint+trade must equal the
    // ratio of token A and B in the pool after the trade has concluded. We also know that △a can be solved for as
    // △a=(△bλR_a)/(R_b+△bλ) by manipulating a known uniswap equation. Using this equation and the expression of ratios
    // we can solve simultaneously for △b. I.e how many short tokens do we need to sell such that the ratio of long and
    // short after the trade equal the pool ratios. Numerically, this works out to this form:
    // △b=(sqrt(R_b(R_a+m)(R_a(R_b(λ^2+2λ+1)+4λm)+R_b(λ^2-2λ+1)m))+R_b(-λ-1)(R_a+m))/(2λ(R_a+m)). For how this was solved
    // from the algebraic solution above see https://bit.ly/3jn7AF6 on wolfram alpha showing the derivation.
    function computeSwapToMintAtPoolRatio(
        FixedPoint.Signed memory m,
        FixedPoint.Signed memory ra,
        FixedPoint.Signed memory rb
    ) private pure returns (bool, uint256) {
        FixedPoint.Signed memory numerator1 =
            sqrt(
                rb.mul(ra.add(m)).mul(
                    ra
                        .mul(rb.mul(lambda2().add(num(2).mul(lambda())).add(num(1))).add(num(4).mul(lambda().mul(m))))
                        .add(rb.mul(lambda2().sub(num(2).mul(lambda())).add(num(1))).mul(m))
                )
            );

        FixedPoint.Signed memory numerator2 = rb.mul(ra.add(m)).mul(num(-1).sub(lambda()));

        FixedPoint.Signed memory numerator = numerator1.mul(1e9).add(numerator2);

        FixedPoint.Signed memory denominator = num(2).mul(lambda()).mul(ra.add(m));

        FixedPoint.Signed memory tradeSize = numerator.div(denominator);

        // If the trade size is negative then we are traversing the equation backwards. In this case the contract must
        // swap between swapTokensForExactTokens and swapExactTokensForTokens methods as we are always solving for △b.
        // In other words, we are always solving for how many short tokens are needed to be bought/sold. If the number
        // is positive then we are buying them. if it is negative then we are selling them. In the case we are selling
        // them (negative) then we swap the polarity and apply the swap fee to the trade.
        bool aToB = tradeSize.isLessThan(0);
        return (aToB, uint256(aToB ? applySwapFee(tradeSize.mul(-1)).rawValue : tradeSize.rawValue));
    }

    // Syntactical sugar to calculate square root of a number.
    function sqrt(FixedPoint.Signed memory _num) private pure returns (FixedPoint.Signed memory) {
        return FixedPoint.Signed(int256(Babylonian.sqrt(uint256(_num.rawValue))));
    }

    // Syntactical sugar to convert a int256 to a Fixedpoint.Signed.
    function num(int256 _num) private pure returns (FixedPoint.Signed memory) {
        return FixedPoint.fromUnscaledInt(_num);
    }

    // Takes an input fixedPoint.Signed num and returns the num scaled by 0.997. 0.3% swap fee as in uniswap.
    function applySwapFee(FixedPoint.Signed memory _num) private pure returns (FixedPoint.Signed memory) {
        return _num.mul(997).div(1000);
    }

    // 1 with 0.3% fees applied.
    function lambda() private pure returns (FixedPoint.Signed memory) {
        return applySwapFee(FixedPoint.fromUnscaledInt(1));
    }

    // 1 with 0.3% fees applied twice.
    function lambda2() private pure returns (FixedPoint.Signed memory) {
        return applySwapFee(lambda());
    }

    /**
     * @notice Mint long and short tokens and convert all of one side into the other.
     * @dev The caller of this method needs to approve `amountCollateral` collateral to be spent by this contract.
     * @param callingAsEOA If True, caller has balance of collateral and expects to receive back all long/short tokens.
     * @param sellLong If True, converts all long tokens into short, else the opposite.
     * @param longShortPair LSP contract address to mint position on.
     * @param router Contract to call to exchange long and short tokens.
     * @param amountCollateral Amount of collateral to deposit and mint long and short tokens against.
     * @param swapPath `Router.swapExactTokensForTokens` param: path with which to swap token to sell for the other.
     * @param deadline `Router.swapExactTokensForTokens` param: time before transaction must be mined.
     */
    function atomicMintSellOneSide(
        bool callingAsEOA,
        bool sellLong,
        LongShortPair longShortPair,
        IUniswapV2Router01 router, /* TODO: Should we allow `router` to be any exchange, such as a Matcha multihop? */
        uint256 amountCollateral,
        address[] memory swapPath,
        uint256 deadline
    ) public {
        require(address(longShortPair) != address(0), "Invalid long short pair");
        require(address(router) != address(0), "Invalid router");
        require(amountCollateral != 0, "Collateral to mint with");

        IERC20 collateralToken = IERC20(longShortPair.collateralToken());

        // 0) Pull collateral from caller if necessary and approve LSP to spend it.
        if (callingAsEOA)
            TransferHelper.safeTransferFrom(address(collateralToken), msg.sender, address(this), amountCollateral);

        TransferHelper.safeApprove(address(collateralToken), address(longShortPair), amountCollateral);

        // 1) Deposit collateral into LSP and mint long and short tokens.
        uint256 tokensToCreate =
            FixedPoint.fromUnscaledUint(amountCollateral).div(longShortPair.collateralPerPair()).rawValue;
        longShortPair.create(tokensToCreate);

        // 2) Determine which token we are selling and convert it all into the other.
        IERC20 soldToken = IERC20(sellLong ? longShortPair.shortToken() : longShortPair.longToken());
        TransferHelper.safeApprove(address(soldToken), address(router), soldToken.balanceOf(address(this)));
        require(swapPath[0] == address(soldToken), "Sold token != 0th swapPath");
        router.swapExactTokensForTokens(
            soldToken.balanceOf(address(this)), // sell all of the sold tokens held by the contract.
            0,
            swapPath,
            address(this),
            deadline
        );

        // 3) Send tokens back to caller if necessary.
        if (callingAsEOA) {
            IERC20 purchasedToken = IERC20(!sellLong ? longShortPair.shortToken() : longShortPair.longToken());
            TransferHelper.safeTransfer(address(purchasedToken), msg.sender, purchasedToken.balanceOf(address(this)));
        }
    }

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
    ) internal pure returns (IUniswapV2Pair pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        pair = IUniswapV2Pair(
            address(
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
            )
        );
    }
}
