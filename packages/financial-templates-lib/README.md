# @uma/financial-templates-lib

This package contains various clients and helpers to interact with UMA's financial templates. It is primarily used to
power the disputer, liquidator, and monitor bots.

## Installing the package

```bash
yarn add @uma/financial-templates-lib
```

## Importing the package

```js
const { FinancialContractClient, GasEstimator } = require("@uma/financial-templates-lib")
```

## Clients

The three clients available are:

1. The `FinancialContractClient` can be used to access information about Financial Contract sponsors and their collateralization
   ratios. To understand how to interact with the client, see the class documentation
   [here](./src/clients/FinancialContractClient.js).

1. The `FinancialContractEventClient` can be used to access historical events that were emitted by a Financial Contract. To
   understand how to interact with the client, see the class documentation
   [here](./src/clients/FinancialContractEventClient.js).

1. The `TokenBalanceClient` tracks the collateral and synthetic balances for a list of wallets. To understand how to
   interact with the client, see the class documentation
   [here](./src/clients/TokenBalanceClient.js).

## Price Feeds

The package offers a variety of price feed implementations that adere to the `PriceFeedInterface` (docs can be found in
the interface file [here](./src/price-feed/PriceFeedInterface.js)):

- The `CryptoWatchPriceFeed`, found [here](./src/price-feed/CryptoWatchPriceFeed.js), uses https://cryptowat.ch/ as a
  source of CEX price data.
- The `UniswapPriceFeed`, found [here](./src/price-feed/UniswapPriceFeed.js), uses a Uniswap (v2) market TWAP as the
  price source. Note: the TWAP length can be set to 0 to make this an instantaneous price.
- THe `BalancerPriceFeed`, found [here](./src/price-feed/BalancerPriceFeed.js), uses a Balancer market as the price
  source.
- The `MedianizerPriceFeed`, found [here](./src/price-feed/MedianizerPriceFeed.js), takes multiple price feeds and
  returns the median of their prices.

There are a few other helper/utility files that are relevant:

- [CreatePriceFeed.js](./src/price-feed/CreatePriceFeed.js) has a variety of factory utilities that will create a
  price feed given an input configuration.
- [DefaultPriceFeedConfigs.js](./src/price-feed/DefaultPriceFeedConfigs.js) contains a list of default price feeds
  for different identifiers in the UMA ecosystem. These are used by `CreatePriceFeed.js` to create price feeds with
  no or incomplete input configurations.
- [Networker.js](./src/price-feed/CreatePriceFeed.js) has a mockable object that sends network requests and is used by
  many objects in financial-templates-lib to send requests.

## Logger

The [Logger](./src/logger) directory contains helpers and factories for logging with Winston. To get the default
logger:

```js
const { Logger, createPriceFeed, Networker } = require("@uma/financial-templates-lib");

// A winston logger is required for createPriceFeed, networker and other objects in financial-templates-lib.
const networker = new Networker(Logger);
const priceFeed = createPriceFeed(Logger, web3, networker, ...);

// You can also log directly using the winston logger.
Logger.debug({
    at: "createPriceFeed",
    message: "Creating CryptoWatchPriceFeed",
    otherParam: 5
});
```

## Helpers

There are two helper files that are available in financial-templates-lib:

- [delay.js](./src/helpers/delay.js): simple file containing a function to "sleep".
- [GasEstimator.js](./src/helpers/GasEstimator.js): `GasEstimator` provides an estimate of the current fast gas price.
