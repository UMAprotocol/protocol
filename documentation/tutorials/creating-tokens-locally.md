# Creating tokens locally

In this tutorial, we'll create a BTC/USD token collateralized with an ERC-20 token (a stand in for DAI) via the
UMA token builder. We will spin up the system locally on Ganache, push a price for BTC/USD, and create a token.

## Prerequisites

All of our tutorials require that you complete the steps in [Prerequisites](./prerequisites.md).

## Deploy smart contracts to Ganache

First, we'll start a blockchain locally using Ganache and deploy the UMA smart contracts to it. The underlying products
we can track are configured via a json file `identifiers.json`.

TODO: Add detailed doc on identifiers.json.

Run all commands in this section from the `core/` directory.

1. Start the Ganache UI.
1. Switch to a test identifier config:
```bash
mv core/config/identifiersTest.json core/config/identifiers.json
```
1. Deploy smart contracts to the locally running Ganache instance via:
```bash
$(npm bin)/truffle migrate --reset --network test
```

After this step, the smart contracts are deployed and can be interacted with.

## Pushing prices (manually)

Run all commands in this section from the `core/` directory.

In production, we can run a job on a cloud provider that fetches prices from a data API and pushes them to the
blockchain. An example of such a script is `core/scripts/PublishPrices.js`.

Locally, however, let's skip the step of setting up a data feed and manually push a price for `BTCUSD` via:

```bash
$(npm bin)/truffle exec scripts/ManualPublishPriceFeed.js --identifier BTCUSD --price <price> --time <time>
```

where `<price>` is the current price of Bitcoin in USD and `<time>` is the current UNIX timestamp in seconds.

For example, if the price of Bitcoin were `$8,923` at 10/21/2019 15:40 EDT, run:
```bash
$(npm bin)/truffle exec scripts/ManualPublishPriceFeed.js --identifier BTCUSD --price 8293 --time 1571686800
```

## UMA token builder

Run all commands in this section from the `sponsor-dapp-v2/` directory.

1. Run `npm start` to start the UMA token builder GUI.
1. Chrome should automatically load the UI. If not, navigate to `localhost:3000`.
1. Click on "Get Started".
1. Click on "Testnet DAI faucet" to get some of the ERC-20 token we'll be using as collateral.
1. Click "Open token facility" and select "BTCUSD" as the price index. Go through the remaining set up flow.

We now have a synthetic token tracking the BTCUSD price.

To see our token valuation change as the BTC price changes, we can either push more prices using
`ManualPublishPriceFeed.js`, as above, or see the price-feed-configuration.md doc to set up a real price feed.
