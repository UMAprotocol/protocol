# Customizing tokens via CLI

In this tutorial, we'll dig into more details and go beyond what the dApp allows.
We'll customize the parameters of synthetic tokens via the command line by creating a BTC token
margined in ETH and interacting with it via the command line.

## Financial engineering note

The financial engineering of this token is _complicated_, because the creator is exposed to both Bitcoin and ETH price moves.

## Prerequisites

All of our tutorials require that you complete the steps in [Prerequisites](./prerequisites.md). If you are new to the UMA
system, start with [Creating tokens locally](./creating-tokens-locally.md) to get a gentle introduction.

Make sure you have testnet ETH or are running locally. All commands should be run from the `core` directory.

## Token creation

First, launch the Truffle console:

```
$(npm bin)/truffle console --network=<networok>
```

Pass `--network=test` for local runs. We'll type the rest of the commands in this document into the Truffle console.

We'll grab an instance of the `Voting` contract.

```
> const voting = await Voting.deployed()
```

Next, we'll verify that the identifier `BTC/USD` is supported (note that `isIdentifierSupported` takes a bytes32 not a
string):

```
> await voting.isIdentifierSupported(web3.utils.utf8ToHex("BTC/USD"))
*true*
```

As an example, the identifier `UNSUPPORTED` is not supported and we'd see:
```
> await voting.isIdentifierSupported(web3.utils.utf8ToHex("UNSUPPORTED"))
*false*
```

The contract `TokenizedDerivativeCreator` maintains a margin currency whitelist.  We'll check that the margin currency
we want to use, `ETH`, is whitelisted. We represent `ETH` via the special address
`0x0000000000000000000000000000000000000000`.

```
> const creator = await TokenizedDerivativeCreator.deployed()
> const whitelistAddress = await creator.marginCurrencyWhitelist()
> const whitelist = await AddressWhitelist.at(whitelistAddress)
> await whitelist.isOnWhitelist("0x0000000000000000000000000000000000000000");
*true*
```

We're all set the create the token now. Note that there are large number of customization options for
`TokenizedDerivative`: this tutorial only scratches the surface.

```
> const priceFeed = await ManualPriceFeed.deployed()
> const noLeverageCalculator = await LeveragedReturnCalculator.deployed()
> const params = { priceFeedAddress: priceFeed.address, defaultPenalty: web3.utils.toWei("0.5", "ether"), supportedMove: web3.utils.toWei("0.1", "ether"), product: web3.utils.utf8ToHex("BTC/USD"), fixedYearlyFee: web3.utils.toWei("0.01", "ether"), disputeDeposit: web3.utils.toWei("0.5", "ether"), returnCalculator: noLeverageCalculator.address, startingTokenPrice: web3.utils.toWei("1", "ether"), expiry: 0, marginCurrency: "0x0000000000000000000000000000000000000000", withdrawLimit: web3.utils.toWei("0.33", "ether"), returnType: "1", startingUnderlyingPrice: "0", name: "Name", symbol: "SYM" }
> await creator.createTokenizedDerivative(params)
```

If all went well, we'll see a large transaction receipt, and in particular, in the event `logs`, there'll be an event
named `CreatedTokenizedDerivative` with an `address` field. That's the address of our newly deployed token.

Let's grab our token so we can interact with it further:
```
const tokenizedDerivative = await TokenizedDerivative.at(<whatever your address was>)
```

## Token interaction

Let's deposit 100 ETH in our token. All numbers are represented in the contract as Wei, i.e., 10**18, so `5` is
represented as `5e18`.

```
await tokenizedDerivative.deposit(web3.utils.toWei("100"), { value: web3.utils.toWei("100") })
```

And create some tokens:

```
await tokenizedDerivative.createTokens(web3.utils.toWei("1000"), web3.utils.toWei("1"), { value: web3.utils.toWei("1000") })
```

This particular token is enormously overcollateralized.

There's a lot more we can do with the tokenized derivative! Check the detailed documentation for all the methods.
