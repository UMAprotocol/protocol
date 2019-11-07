# Price feed configuration

This document explains how price feed identifiers are configured and how they are used.

## What is an identifier

An identifier is the term we use to refer to an underlying asset whose price a derivative tracks. Examples of underlying
assets are the price of Bitcoin in US dollars, the spot price of gold in US dollars, or the daily high temperature in
New York City.

## Configuration file

Price feed identifiers are configured in [identifiers.json](https://github.com/UMAprotocol/protocol/blob/master/core/config/identifiers.json).
This json file contains a list of entries for each supported identifier, with two bits of configuration information:
1. `dappConfig`: configuration for the Sponsor dApp. See the [Sponsor dApp](#sponsor-dapp) section for more details.
2. `uploaderConfig`: configuration for UMA's price feed uploader. See the [Uploader](#uploader) section for more details.

The configuration will look like:
```js
{
    "IDENTIFIER": {
        "dappConfig": {
            // ...
        },
        "uploaderConfig": {
            // ...
        }
    },
    "IDENTIFIER2": {
        "dappConfig": {
            // ...
        },
        "uploaderConfig": {
            // ...
        }
    }
}
```

To support a new identifier, follow these steps:
1. Add an entry to `identifiers.json` with both `dappConfig` and `uploaderConfig`.
2. Approve the identifier in the Oracle. Locally, you can run:

   ```bash
   $(npm bin)/truffle exec scripts/local/ApproveIdentifiers.js --network=test
   ```

3. Push at least one price. Locally, you can manually push a price:

   ```bash
   $(npm bin)/truffle exec scripts/ManualPublishPriceFeed.js --identifier <identifier> --price <price> --time <time> --network=test
   ```

   Or you can run UMA's price feed uploader:

   ```bash
   $(npm bin)/truffle exec scripts/PublishPrices.js --network=test
   ```

   Note that running the price feed may require several API keys to be provided as environment variables.

## Sponsor dApp

The [Sponsor dApp](https://github.com/UMAprotocol/protocol/tree/master/sponsor-dapp-v2) references the `dappConfig` field.
If the identifier is supported, the dApp allows you to select it as the index for your synthetic token.

An example config looks like:
```json
"dappConfig": {
    "expiries": [1572552000, 1575061200, 1577826000, 0],
    "supportedMove": "0.15"
}
```

The `dappConfig` section contains two fields:
1. `expiries`: timestamps of expirations supported in the dApp for synthetic tokens tracking this index. A value of `0`
   indicates no expiry (i.e., a perpetual product). Expiries are configured per identifier.
2. `supportedMove`: fraction of move in the underlying price. Higher volatility assets should have a higher
   `supportedMove`. Financial contract templates use this value to reduce the probability of liquidation by making sure
   they hold on to enough collateral to support a move of this size.

If you want to use a different expiry or a different supported move, you can either modify `identifiers.json` for local
runs or configure your token via the command line.

## Uploader

UMA's price feed uploader script [PublishPrices.js](https://github.com/UMAprotocol/protocol/blob/master/core/scripts/PublishPrices.js)
references the `uploaderConfig` field. If you bring your own price feed, you can configure it your own way.

An example config looks like:
```json
"uploaderConfig": {
    "publishInterval": "900",
    "minDelay": "0",
    "numerator": {
        "dataSource": "CMCGlobalMetric",
        "assetName": "total_market_cap"
    },
    "denominator": {
        "dataSource": "Constant",
        "assetName": "1000000000"
    }
}
```

The actual price fetching logic is divided into `numerator` and `denominator`, each of which configures a price fetch
from a data source. The actual pushed price is `numerator/denominator` if `denominator` is specified, otherwise just
`numerator`. Both `numerator` and `denominator` have two fields:
1. `dataSource`: string identifying where to fetch data from. The script `PublishPrices.js` supports several data
   sources. Each data source requires custom code to handle the data fetch, and some data sources also require API keys.
2. `assetName`: name of the asset that the data source should be queried with. For example, on crypto exchange
   `MyExchange`, bitcoin might be `BTC` but on crypto exchange `YourExchange`, it might be `BTCUSD`.

The other two fields are used in conjuction to determine the rate at which new prices are published to the blockchain
and also to limit the frequency with which data APIs are queried.
1. `publishInterval`: number of seconds between price pushes, e.g., `900` means push a new price every 15 minutes.
2. `minDelay`: number of seconds the fetched data is delayed by, e.g., `900` means that fetched data has a built-in 15
   minutes delay.

## AVS

The automated voting system uses its own configuration, which is currently hardcoded in
[Voting.js](https://github.com/UMAprotocol/protocol/blob/master/core/scripts/Voting.js). We have purposely kept it separate
from the other configuration, because the DVM and its scaffolding are separate from the financial contracts and their scaffolding.
