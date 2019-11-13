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

### Parameters

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
