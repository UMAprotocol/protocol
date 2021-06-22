// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
        uint256 amountCollateral
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
        longShortPair.create(amountCollateral);

        // 2) Send long and short tokens to the pair address and call the low-level mint function. This amounts to
        // single asset deposit where the one side will be sold for the other to match the pool ratio.
        IUniswapV2Pair pair = pairFor(router.factory(), longToken, shortToken);
        TransferHelper.safeTransfer(address(longToken), address(pair), longToken.balanceOf(address(this)));
        TransferHelper.safeTransfer(address(shortToken), address(pair), shortToken.balanceOf(address(this)));
        pair.mint(callingAsEOA ? msg.sender : address(this));
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

    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, "UniswapV2Library: IDENTICAL_ADDRESSES");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "UniswapV2Library: ZERO_ADDRESS");
    }

    // calculates the CREATE2 address for a pair without making any external calls
    function pairFor(
        address factory,
        IERC20 tokenA,
        IERC20 tokenB
    ) internal pure returns (IUniswapV2Pair pair) {
        (address token0, address token1) = sortTokens(address(tokenA), address(tokenB));
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
