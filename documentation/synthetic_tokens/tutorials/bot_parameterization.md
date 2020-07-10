# Liquidator, disputer and monitor bot parameterization

The UMA liquidator, disputer and monitor bots are highly configurable enabling their operation to be fine tuned in different environments and contexts. At the same time the bots are designed to be as config light as possible through the use of aggressive defaulting. This makes the bots simple to set up if you don't need all the extra bells and whistles that come with the more involved configs.

This doc outlines possible configuration options for bot deployment. Across the three bots there is a fair amount of shared configuration. This shared logic is first outlined. After this, bot specific configs are listed.

## Common configuration settings

## Liquidator bot

The liquidation bot monitors all open positions within a given expiring multi-party contract and liquidates positions if their collateralization ratio, as inferred from off-chain information about the value of the price identifier, drops below a given threshold.

### Minimum viable config:

You can run a liquidator bot by simply providing the EMP address of the contract you want to monitor and a mnemonic with an associated private key that the bot should use. Minimal Docker `.env` is as follows:

```bash
EMP_ADDRESS=0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1
MNEMONIC=sail chuckle school attitude symptom tenant fragile patch ring immense main rapid
## Be sure to replace with your mnemonic.
COMMAND=npx truffle exec ../liquidator/index.js --network kovan_mnemonic
```

### Possible liquidator config options:

- `EMP_ADDRESS`**[required]**: address of the deployed expiring multi party contract on the given network you want to connect to. This config defines the synthetic that the bot will be liquidating.
- `MNEMONIC`**[required]**: defines the wallet for the bots to use. Generate and seed with Ether & synthetics before running the bot.
- `COMMAND`**[required if using Docker]**: initial entry point the bot uses when the bot's Docker container starts running.
- `POLLING_DELAY`**[optional]**: how long the bot should wait (in seconds) before running a polling cycle. If excluded the bot defaults to polling every 60 seconds.
- `PRICE_FEED_CONFIG`**[optional]**: configuration object used to parameterize the bot's price feed. If excluded then the bot will try and infer the price feed based on the identifer name. Optionally, you can override this. This config, if provided, contains the following:
  - `type` specifies the configuration of the price feed. The `medianizer` provides the median of the price of the identifier over a set of different exchanges.
  - `apiKey` is the key generated in API key section of the Prerequisites.
  - `pair` defines the crypto pair whose price is being fetched as defined in CryptoWatch. Ex: `ethbtc`.
  - `lookback` defines a window size, in seconds, over which historical prices will be made available by the price feed. This parameter should be set to be at least as large as the liquidation liveness period of the EMP contract.
  - `minTimeBetweenUpdates` minimum number of seconds between updates. If update is called more frequently, no new price data will be fetched.
  - `medianizedFeeds` is an array of type `priceFeed` that defines the feeds overwhich the medianizer will take the median of. Each of these have their own components which are defined as:
    - `type` Each instance of the medianizer is also a type. This could be a `medianizer`, `uniswap` or `cryptowatch` depending on the configuration of the bot. The sample bot is using only `cryptowatch` price feeds to compute the median.
    - `exchange` a string identifier for the exchange to pull prices from. This should be the identifier used to identify the exchange in CW's REST API.
- `LIQUIDATOR_CONFIG` [optional]: enables the override of specific bot settings. Contains the following sub-settings.
  - `crThreshold`: Liquidate if a positions collateral falls more than this % below the min CR requirement.
  - `liquidationDeadline`: Aborts if the transaction is mined this amount of time after the last update (in seconds).
  - `liquidationMinPrice`: Aborts if the amount of collateral in the position per token is below this ratio.
  - `txnGasLimit` Gas limit to set for sending on-chain transactions.
  - `logOverrides`: override specific events log levels. Define each logic action and the associated override level. For example to override liquidation log from `info` to `warn` use:`{"positionLiquidated":"warn"}}`
- `ENVIRONMENT`[optional]: when set to `production`, will pipe logs to GCP stackdriver.
- `SLACK_WEBHOOK`[optional]: can be included to send messages to a slack channel.
- `PAGERDUTY_API_KEY`[optional]: if you want to configure your bot to send pager duty messages(sms, phone calls, or emails) when they crash or have `error` level logs you'll need an API key here.
- `PAGERDUTY_SERVICE_ID`[optional]: each Pagerduty service has an unique id. This goes here.
- `PAGERDUTY_FROM_EMAIL`[optional] each Pagerduty service also requires a `from email` to uniquely identify the logger.
- `INFURA_API_KEY`[optional]: override the default Infura key used by the bot.
- `LIQUIDATOR_OVERRIDE_PRICE`[optional]: override the liquidator input price. Can be used if there is an error in the bots price feed to force liquidations at a given price.

## Disputer bots

The dispute bot monitors all liquidations occurring within a given expiring multi-party contract and initiates disputes against liquidations it deems invalid, as inferred from off-chain information about the value of the price identifier.
A liquidation is invalid if a position was correctly collateralized at the time of liquidation.

### Minimum viable config:

You can run a disputer bot by simply providing the EMP address of the contract you want to monitor and a mnemonic with an associated private key that the bot should use. Minimal Docker `.env` is as follows:

```bash
EMP_ADDRESS=0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1
MNEMONIC=sail chuckle school attitude symptom tenant fragile patch ring immense main rapid
## Be sure to replace with your mnemonic.
COMMAND=npx truffle exec ../disputer/index.js --network kovan_mnemonic
```

### Possible liquidator config options:

- `EMP_ADDRESS`**[required]**: address of the deployed expiring multi party contract on the given network you want to connect to. This config defines the synthetic that the bot will be disputing.
- `MNEMONIC`**[required]**: defines the wallet for the bots to use. Generate and seed with Ether & synthetics before running the bot.
- `COMMAND`**[required if using Docker]**: initial entry point the bot uses when the bot's Docker container starts running.
- `POLLING_DELAY`**[optional]**: how long the bot should wait (in seconds) before running a polling cycle. If excluded the bot defaults to polling every 60 seconds.
- `PRICE_FEED_CONFIG`**[optional]**: configuration object used to parameterize the bot's price feed. If excluded then the bot will try and infer the price feed based on the identifer name. Optionally, you can override this. This config, if provided, contains the following:
  - `type` specifies the configuration of the price feed. The `medianizer` provides the median of the price of the identifier over a set of different exchanges.
  - `apiKey` is the key generated in API key section of the Prerequisites.
  - `pair` defines the crypto pair whose price is being fetched as defined in CryptoWatch. Ex: `ethbtc`.
  - `lookback` defines a window size, in seconds, over which historical prices will be made available by the price feed. This parameter should be set to be at least as large as the liquidation liveness period of the EMP contract.
  - `minTimeBetweenUpdates` minimum number of seconds between updates. If update is called more frequently, no new price data will be fetched.
  - `medianizedFeeds` is an array of type `priceFeed` that defines the feeds overwhich the medianizer will take the median of. Each of these have their own components which are defined as:
    - `type` Each instance of the medianizer is also a type. This could be a `medianizer`, `uniswap` or `cryptowatch` depending on the configuration of the bot. The sample bot is using only `cryptowatch` price feeds to compute the median.
    - `exchange` a string identifier for the exchange to pull prices from. This should be the identifier used to identify the exchange in CW's REST API.
- `DISPUTER_CONFIG` [optional]: enables the override of specific bot settings. Contains the following sub-settings.
  - `disputeDelay`: how l
  - `txnGasLimit`
- `ENVIRONMENT`[optional]: when set to `production`, will pipe logs to GCP stackdriver.
- `SLACK_WEBHOOK`[optional]: can be included to send messages to a slack channel.
- `PAGERDUTY_API_KEY`[optional]: if you want to configure your bot to send pager duty messages(sms, phone calls, or emails) when they crash or have `error` level logs you'll need an API key here.
- `PAGERDUTY_SERVICE_ID`[optional]: each Pagerduty service has an unique id. This goes here.
- `PAGERDUTY_FROM_EMAIL`[optional] each Pagerduty service also requires a `from email` to uniquely identify the logger.
- `INFURA_API_KEY`[optional]: override the default Infura key used by the bot.
- `LIQUIDATOR_OVERRIDE_PRICE`[optional]: override the liquidator input price. Can be used if there is an error in the bots price feed to force liquidations at a given price.

## Monitor bots
