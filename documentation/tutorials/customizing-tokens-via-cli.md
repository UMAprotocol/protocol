# Customizing tokens via CLI

In this tutorial, we'll dig into more details and go beyond what the [Synthetic Token Builder dApp](http://tokenbuilder.umaproject.org/) allows.
We'll customize the parameters of synthetic tokens via the command line by creating a BTC/USD token
collateralized in ETH and interacting with it via the command line. This is a token where payouts are 
in ETH, and depend upon the price of BTC/USD.

## Financial engineering note

* Every token facility has a Collateralization Ratio parameter, which you can set.

* If the price of BTC/USD is $10,000, the token facility will require that at least (10,000 * Collateralization Ratio)
  ETH are deposited in the token facility. If the Collateralization Ratio is 1.25, the token facility will require that
  at least 10,000 * 1.25 = 12,500 ETH are in the token facility. 
  
* The Collateralization Ratio remains constant while the total amount of ETH required changes with the price of BTC/USD.
  See table below for reference. 
  
    | BTC/USD Index | Amount of ETH Required |
    |---------------|------------------------|
    | $8,000        | 10,000                |
    | $10,000       | 12,500                |
    | $12,000       | 15,000                |

* The token facility will require these minimum collateralization amounts, no matter what the price of ETH/USD is.

## Prerequisites

All of our tutorials require that you complete the steps in [Prerequisites](./prerequisites.md). If you are new to the UMA
system, start with [Creating tokens locally](./creating-tokens-locally.md) to get a gentle introduction.

Make sure you have testnet ETH or are running locally. All commands should be run from the `core` directory.

The important steps to complete for this tutorial are:
* Deploying the contracts:
```bash
$(npm bin)/truffle migrate --reset --network test
```
* Manually pushing a price to the price feed for the specific token facility that we want to create, for example:
```bash
$(npm bin)/truffle exec scripts/ManualPublishPriceFeed.js --identifier BTC/USD --price 8293 --time 1571686800
```

## Token creation

First, launch the Truffle console:

```bash
$(npm bin)/truffle console --network=<network>
```

Pass `--network=test` for local runs. For the UMA testnet deployment on Rinkeby, pass `--network=rinkeby_mnemonic` and
provide your mnemonic in an environment variable `MNEMONIC`. We'll type the rest of the commands in this document into
the Truffle console.

We'll grab an instance of the `Voting` contract.

```js
const voting = await Voting.deployed()
```

Next, we'll verify that the identifier `BTC/USD` is supported (note that `isIdentifierSupported` takes a bytes32 not a
string):

```js
await voting.isIdentifierSupported(web3.utils.utf8ToHex("BTC/USD"))
// returns true
```

As an example, the identifier `UNSUPPORTED` is not supported and we'd see:

```js
> await voting.isIdentifierSupported(web3.utils.utf8ToHex("UNSUPPORTED"))
// returns false
```

The contract `TokenizedDerivativeCreator` maintains a margin currency whitelist.  We'll check that the margin currency
we want to use, `ETH`, is whitelisted. We represent `ETH` via the special address
`0x0000000000000000000000000000000000000000`.

```js
const creator = await TokenizedDerivativeCreator.deployed()
const whitelistAddress = await creator.marginCurrencyWhitelist()
const whitelist = await AddressWhitelist.at(whitelistAddress)
await whitelist.isOnWhitelist("0x0000000000000000000000000000000000000000")
// returns true
```

We're all set the create the token now. Note that there are large number of customization options for
`TokenizedDerivative`: this tutorial only scratches the surface.

```js
const priceFeed = await ManualPriceFeed.deployed()
const noLeverageCalculator = await LeveragedReturnCalculator.deployed()
const params = { priceFeedAddress: priceFeed.address, defaultPenalty: web3.utils.toWei("0.5", "ether"), supportedMove: web3.utils.toWei("0.1", "ether"), product: web3.utils.utf8ToHex("BTC/USD"), fixedYearlyFee: web3.utils.toWei("0.01", "ether"), disputeDeposit: web3.utils.toWei("0.5", "ether"), returnCalculator: noLeverageCalculator.address, startingTokenPrice: web3.utils.toWei("1", "ether"), expiry: 0, marginCurrency: "0x0000000000000000000000000000000000000000", withdrawLimit: web3.utils.toWei("0.33", "ether"), returnType: "1", startingUnderlyingPrice: "0", name: "Name", symbol: "SYM" }
const creationReceipt = await creator.createTokenizedDerivative(params)
```

Note, in particular, the following two fields in params:

```js
{
    marginCurrency: "0x0000000000000000000000000000000000000000",
    product: web3.utils.utf8ToHex("BTC/USD")
}
```

Those choose the margin currency and the underlying asset.

If all went well, we'll see a large transaction receipt, and in particular, in the event `logs`, there'll be an event
named `CreatedTokenizedDerivative` with a `contractAddress` field. This contains the address of our newly deployed token, which you can print with:

```js
creationReceipt.logs[0].args.contractAddress
// ex. '0xA00F315bdE7c07D35f128dDC8Cdf99B06B8c9d63'
```

Let's grab our token so we can interact with it further:

```js
const tokenizedDerivative = await TokenizedDerivative.at(/*whatever your address was*/)
```

## Token interaction

You can interact with the deployed token via the command line or a dapp. 

Access the dapp at https://tokenbuilder.umaproject.org/. This point-and-click dapp will allow you to easily deposit collateral into the contract, borrow tokens, top up or remove additional collateral, and redeem tokens. We strongly recommend using the dapp for clarity. 

Alternatively, you can interact with the deployed token via the command line. Below, we'll deposit 10 ETH in our token. All numbers are represented in the contract as Wei, i.e., 10**18, so `5` is
represented as `5e18`.

```js
await tokenizedDerivative.deposit(web3.utils.toWei("10"), { value: web3.utils.toWei("10") })
```

And create 1 token with 10 ETH as collateral:

```js
await tokenizedDerivative.createTokens(web3.utils.toWei("10"), web3.utils.toWei("1"), { value: web3.utils.toWei("10") })
```

This particular token is enormously overcollateralized.

There's a lot more we can do with the tokenized derivative! Check the detailed documentation for all the methods.
