# Tokenized Derivative Contract

The Tokenized Derivative is the primary contract template behind the
[Synthetic Token Builder](https://tokenbuilder.umaproject.org) that allows users to create synthetic tokens that track
anything. For an explanation of how the contract works from a financial perspective, see this
[blog post](https://medium.com/uma-project/announcing-the-uma-synthetic-token-builder-8bf37c645e94) and the
[FAQ](http://docs.google.com/document/d/1CLo02hXrcS3r5t8JeyyiT4ZyfqW0WJBgBh1lWIDghYE/).

If you'd like to take a look at the code for this contract, it's located
[here](https://github.com/UMAprotocol/protocol/blob/master/core/contracts/TokenizedDerivative.sol).

## Creation

All Tokenized Derivative deployments must be sent through the
[Tokenized Derivative Creator contract](https://github.com/UMAprotocol/protocol/blob/master/core/contracts/TokenizedDerivativeCreator.sol).
This creator contract is responsible for constructing the a user's Tokenized Derivative. In other words, the Tokenized
Derivative Creator is just a Tokenized Derivative factory. To understand why this factory pattern is necessary, please
see the [architecture explainer](./architecture.md).

To create a Tokenized Derivative, one would call the `createTokenizedDerivative(params)` method on the Tokenized
Derivative Creator. `params` is a struct that allows the user to customize the template.

This is the params struct:

```solidity
struct Params {
    address priceFeedAddress;
    uint defaultPenalty;
    uint supportedMove;
    bytes32 product;
    uint fixedYearlyFee;
    uint disputeDeposit;
    address returnCalculator;
    uint startingTokenPrice;
    uint expiry;
    address marginCurrency;
    uint withdrawLimit;
    TokenizedDerivativeParams.ReturnType returnType;
    uint startingUnderlyingPrice;
    string name;
    string symbol;
}
```

### ERC20 Related Parameters

- `name` is the long-form display name for the token.

- `symbol is the short (three or four capital letters, typically) name for the token.

### Address parameters

- `returnCalculator`: the address of the Return Calculator the Tokenized Derivative should use to compute returns. See
the [Return Calculator Interface](https://github.com/UMAprotocol/protocol/blob/master/core/contracts/ReturnCalculatorInterface.sol)
for an explanation of what a Return Calculator does. Note: return calculators must be added to the whitelist before
they can be used. There are a few pre-approved ones, but if you'd like to use a custom one, you'll need to make sure
it's added to the whitelist.

- `priceFeedAddress`: the address of the Price Feed contract the Tokenized Derivative should use to get unverified
prices. Generally, there's an UMA-provided price feed contract deployed along with the rest of the system that provides
prices for all DVM-approved identifiers. A user might want to deploy their own Price Feed contract if they'd like to
inject custom prices for their token.

- `marginCurrency`: The address of the ERC20 currency used to collateralize the token. `0x0` is used to represent ETH.

### Numerical Parameters

All of these numerical parameters are decimal numbers using a fixed point representation with 18 decimal places.
Put another way, if you want to represent 0.8 or 80%, you would do so by setting the value to 0.8 * 10^18.

- `supportedMove`: used to set the collateralization ratio (margin requirement). It's easier to explain with an
example:

    Let's say that the collaterlization ratio for a 1x S&P 500 token is 120%. 

    If the token sponsor puts in 120% collateral, they are appropriately collateralized. If the price moves up by 1%,
    the sponsor can be liquidated because they are below the collateralization ratio. In that case, however, the token
    holder is protected because they were still above 100%, which means there's still enough collateral for the token
    holder to receive the fair value of the S&P 500.

    Instead, let's assume that the S&P 500 goes up by 21%. The sponsor is below the collateralization ratio again.
    However, this time, the collateralization went below 100%, which means there is not enough collateral left for the
    token holder to receive the fair value of the S&P 500. If the sponsor is liquidated at this point (which they
    should be), the token holders will get less money from the contract than they would've expected.

    In this case, the required collateralization ratio gives the token holder a _supported move_ of 20%, meaning that
    the underlying price would have to go up by 20% from the last time the contract was remargined for the token holder
    to possibly lose money. Put another way, the token holder has a 20% cushion that protects them from sudden price
    moves.

    It's worth noting that `1 + supportedMove` is not always the collateralization ratio. This is because the token can
    have different leverages attached to it. If the leverage in the above case was 2x, then the collateralization ratio
    would have to be 140% to allow the underlying price to increase by 20% without causeing the token holder to lose
    money.

- `defaultPenalty`: the percentage of the required margin (or collateralization ratio - 1) that is taken as penalty
to pay the token holders in the case of a liquidation. For example, if the collateralization ratio was 120% and the
`defaultPenalty` was 0.5, the token holders would be awarded 10% of the token price as a penalty in the case of a
liquidation.

- `disputeDeposit`: the percentage of the required margin (or collateralization ratio - 1) that is posted by the token
sponsor if they wish to initiate a price dispute over the price that the price feed reported. If the price feed is
deemed correct by the DVM, then this deposit is paid to token holders.

- `fixedYearlyFee`: the percentage of the token value that is taken as a fee each year and paid to the token sponsor.
Must be set to 0 if `returnType` is set to Linear.

- `withdrawLimit`: the percentage of the token value that the sponsor can withdraw every 24 hours. Note: the 24 hour
window is non-rolling, meaning the allocation is set at the first withdrawal of the period and drawn down as the period
progresses.

- `startingTokenPrice`: the initial price for a token.

- `startingUnderlyingPrice`: If set to 0, the underlying price will be set to the price that the price feed returns
when the TokenizedDerivative is deployed. If set to a nonzero value, the contract will treat this value as the initial
value that the price feed returned.

- `expiry`: Unix timestamp specifying when the token will expire. Setting this to 0 will cause the token to be
perpetual.

### Other parameters

- `product`: Represents the underlying asset that the token price is based on. This `bytes32` value is used to identify
this asset when communicating with the DVM and price contracts.

- `returnType`: This can either be `Linear` (represented by 0) or `Compound` (represented by 1). Linear means that
returns are always computed using the initial underlying price as a base. Compound means that returns are computed
using the most recent underlying price as a base. Note: this distinction only impacts the token price if the leverage
is not 1.

## Interacting with a Tokenized Derivative

Please see the [Tokenized Derivative Documentation](https://docs.umaproject.org/uma/contracts/TokenizedDerivative.html)
for an explanation of its API.