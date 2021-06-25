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
    // using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @notice Mint long and short tokens and deposit them all into a UniV2 Pool.
     * @dev The caller of this method needs to approve `amountCollateral` collateral to be spent by this contract.
     * @param callingAsEOA If True, caller has balance of collateral and expects to receive back all long/short tokens.
     * @param longShortPair LSP contract address to mint position on.
     * @param router Contract to call to exchange long and short tokens.
     * @param amountCollateral Amount of collateral to deposit and mint long and short tokens against.
     */
    function atomicMintAddLiquidity(
        bool callingAsEOA,
        LongShortPair longShortPair,
        IUniswapV2Router01 router,
        uint256 amountCollateral,
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

        TransferHelper.safeApprove(address(collateralToken), address(longShortPair), amountCollateral);

        // 1) Deposit collateral into LSP and mint long and short tokens.
        uint256 tokensToCreate =
            FixedPoint.fromUnscaledUint(amountCollateral).div(longShortPair.collateralPerPair()).rawValue;

        longShortPair.create(tokensToCreate);

        require(
            longToken.balanceOf(address(this)) == shortToken.balanceOf(address(this)) &&
                longToken.balanceOf(address(this)) == tokensToCreate,
            "Create invariant failed"
        );

        {
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
            if (aToB && tradeSize > 0) {
                path[0] = address(longToken);
                path[1] = address(shortToken);
                TransferHelper.safeApprove(address(longToken), address(router), tradeSize);
                router.swapTokensForExactTokens(tradeSize, type(uint256).max, path, address(this), deadline);
            }
            if (!aToB && tradeSize > 0) {
                path[0] = address(shortToken);
                path[1] = address(longToken);
                TransferHelper.safeApprove(address(shortToken), address(router), tradeSize);
                router.swapExactTokensForTokens(tradeSize, 0, path, address(this), deadline);
            }
        }

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
        {
            if (callingAsEOA) {
                // Send the LP tokens back to the minter.
                IERC20 LPToken = IERC20(address(pairFor(router.factory(), address(longToken), address(shortToken))));
                TransferHelper.safeTransfer(address(LPToken), msg.sender, LPToken.balanceOf(address(this)));

                // Send any dust left over back to the minter.
                TransferHelper.safeTransfer(address(longToken), msg.sender, longToken.balanceOf(address(this)));
                TransferHelper.safeTransfer(address(shortToken), msg.sender, shortToken.balanceOf(address(this)));
            }
        }
    }

    // x = (sqrt(b (a + m) (a (b (λ^2 + 2 λ + 1) + 4 λ m) + b (λ^2 - 2 λ + 1) m)) + b (-λ - 1) (a + m))/(2 λ (a + m))
    function computeSwapToMintAtPoolRatio(
        FixedPoint.Signed memory m,
        FixedPoint.Signed memory ra,
        FixedPoint.Signed memory rb
    ) public pure returns (bool, uint256) {
        // FixedPoint.Signed memory one = FixedPoint.fromUnscaledInt(1);

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

        int256 tradeSize = numerator.div(denominator).rawValue;

        bool bToA = tradeSize > 0;

        return (!bToA, uint256(bToA ? tradeSize : tradeSize * -1));
    }

    function sqrt(FixedPoint.Signed memory num) public pure returns (FixedPoint.Signed memory) {
        return FixedPoint.Signed(int256(Babylonian.sqrt(uint256(num.rawValue))));
    }

    function num(int256 num) public pure returns (FixedPoint.Signed memory) {
        return FixedPoint.fromUnscaledInt(num);
    }

    function applySwapFee(FixedPoint.Signed memory num) public pure returns (FixedPoint.Signed memory) {
        return num.mul(997).div(1000);
    }

    function lambda() public pure returns (FixedPoint.Signed memory) {
        return applySwapFee(FixedPoint.fromUnscaledInt(1));
    }

    function lambda2() public pure returns (FixedPoint.Signed memory) {
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
        longShortPair.create(amountCollateral);

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
