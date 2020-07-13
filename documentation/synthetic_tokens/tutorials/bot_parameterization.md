# Liquidator, disputer and monitor bot parameterization

The UMA liquidator, disputer and monitor bots are highly configurable enabling their operation to be fine tuned in different deployment environments. Additionally, the bots are designed to be runnable in a config light fraomework through aggressive defaulting. This makes the bots simple to set up if you don't need all the settings that come with the more involved configs.

This doc outlines possible configuration options for bot deployment.

## Common configuration settings

Across the three bots (liquidator, disputer and monitor) there is a fair amount of shared configuration. This shared logic is first outlined. After this, bot specific configs are listed.

### Common config

- `EMP_ADDRESS`**[required]**: address of the deployed expiring multi party contract on the given network you want to connect to. This config defines the synthetic that the bot will be liquidating.
- `MNEMONIC`**[required OR `PRIVATE_KEY`]**: defines the wallet for the bots to use. Generate and seed with Ether & synthetics before running the bot.
- `PRIVATE_KEY`**[required OR `MNEMONIC`]**: defines the wallet for the bots to use. Generate and seed with Ether & synthetics before running the bot.
- `COMMAND`**[required if using Docker]**: initial entry point the bot uses when the bot's Docker container starts running.
- `INFURA_API_KEY` [optional]: specify an infura API key for the bot to use. By default this uses a shared key stored in the repo. If you experience issues with accessing infura try adding your own key.
- `CUSTOM_NODE_URL` [optional]: specify a Ethereum RPC node URL. This can run over `https` or `wss` depending on your preference.
- `POLLING_DELAY`[optional]: how long the bot should wait (in seconds) before running a polling cycle. If excluded the bot defaults to polling every 60 seconds.
- `PRICE_FEED_CONFIG`[optional]: configuration object used to parameterize the bot's price feed. If excluded then the bot will try and infer the price feed based on the identifer name. Optionally, you can override this. This config, if provided, contains the following:
  - `type` specifies the configuration of the price feed. The `medianizer` provides the median of the price of the identifier over a set of different exchanges.
  - `apiKey` is the key generated in API key section of the Prerequisites.
  - `pair` defines the crypto pair whose price is being fetched as defined in CryptoWatch. Ex: `ethbtc`.
  - `lookback` defines a window size, in seconds, over which historical prices will be made available by the price feed. This parameter should be set to be at least as large as the liquidation liveness period of the EMP contract.
  - `minTimeBetweenUpdates` minimum number of seconds between updates. If update is called more frequently, no new price data will be fetched.
  - `medianizedFeeds` is an array of type `priceFeed` that defines the feeds overwhich the medianizer will take the median of. Each of these have their own components which are defined as:
    - `type` Each instance of the medianizer is also a type. This could be a `medianizer`, `uniswap` or `cryptowatch` depending on the configuration of the bot. The sample bot is using only `cryptowatch` price feeds to compute the median.
    - `exchange` a string identifier for the exchange to pull prices from. This should be the identifier used to identify the exchange in CW's REST API.
- `ENVIRONMENT`[optional]: when set to `production`, will pipe logs to GCP stackdriver.
- `SLACK_WEBHOOK`[optional]: can be included to send messages to a slack channel.
- `PAGERDUTY_API_KEY`[optional]: if you want to configure your bot to send pager duty messages(sms, phone calls, or emails) when they crash or have `error` level logs you'll need an API key here.
- `PAGERDUTY_SERVICE_ID`[optional]: each Pagerduty service has an unique id. This goes here.
- `PAGERDUTY_FROM_EMAIL`[optional] each Pagerduty service also requires a `from email` to uniquely identify the logger.
- `INFURA_API_KEY`[optional]: override the default Infura key used by the bot.

## Liquidator bot

The liquidation bot monitors all open positions within a given expiring multi-party contract and liquidates positions if their collateralization ratio, as inferred from off-chain information about the value of the price identifier, drops below a given threshold.

### Minimum viable liquidator config:

You can run a liquidator bot by simply providing the EMP address of the contract you want to monitor and a mnemonic with an associated private key that the bot should use. Minimal Docker `.env` is as follows:

```bash
EMP_ADDRESS=0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1
MNEMONIC=sail chuckle school attitude symptom tenant fragile patch ring immense main rapid
# Be sure to replace with your mnemonic.
COMMAND=npx truffle exec ../liquidator/index.js --network kovan_mnemonic
```

### Possible liquidator config options

- `LIQUIDATOR_CONFIG` [optional]: enables the override of specific bot settings. Contains the following sub-settings:
  - `crThreshold`: Liquidate if a positions collateral falls more than this % below the min CR requirement.
  - `liquidationDeadline`: Aborts if the transaction is mined this amount of time after the last update (in seconds).
  - `liquidationMinPrice`: Aborts if the amount of collateral in the position per token is below this ratio.
  - `txnGasLimit` Gas limit to set for sending on-chain transactions.
  - `logOverrides`: override specific events log levels. Define each logic action and the associated override level. For example to override liquidation log from `info` to `warn` use:`{"positionLiquidated":"warn"}}`
- `LIQUIDATOR_OVERRIDE_PRICE`[optional]: override the liquidator input price. Can be used if there is an error in the bots price feed to force liquidations at a given price.

## Disputer bots

The dispute bot monitors all liquidations occurring within a given expiring multi-party contract and initiates disputes against liquidations it deems invalid, as inferred from off-chain information about the value of the price identifier.
A liquidation is invalid if a position was correctly collateralized at the time of liquidation.

### Minimum viable disputer config:

You can run a disputer bot by simply providing the EMP address of the contract you want to monitor and a mnemonic with an associated private key that the bot should use. Minimal Docker `.env` is as follows:

```bash
EMP_ADDRESS=0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1
MNEMONIC=sail chuckle school attitude symptom tenant fragile patch ring immense main rapid
# Be sure to replace with your mnemonic.
COMMAND=npx truffle exec ../disputer/index.js --network kovan_mnemonic
```

### Possible disputer config options

- `DISPUTER_CONFIG` [optional]: enables the override of specific bot settings. Contains the following sub-settings:
  - `disputeDelay`: Amount of time to wait after the request timestamp of the liquidation to be disputed. This makes the reading of the historical price more reliable. Denominated in seconds.
  - `txnGasLimit`: Gas limit to set for sending on-chain transactions.
- `DISPUTER_OVERRIDE_PRICE`[optional]: override the disputer input price. Can be used if there is an error in the bots price feed to force disputes at a given price.

## Monitor bots

The monitor bots are used to monitor the UMA ecosystem for key events. They have a number of monitor modules built into them that enable real time reporting on key events for a given EMP contract. The monitor can report on the following:

- **Balance Monitor**: specify a list of set of key wallets to monitor. Send alerts if their collateral synthetic or ether balance drops below define thresholds.
- **Contract Monitor**: send alerts when liquidation, dispute & dispute settlement events occure.
- **Collateralization ratio monitor**: monitor a given positions CR and send alerts if it drops below a given threshold.
- **Synthetic peg monitor**: monitor an EMP's synthetic and reports when the synthetic trading off peg there is high volatility in the synthetic price or there is high volatility in the reference price.

### Minimum viable monitor config:

The config below will start up a monitor bot that will: 1) send messages when new liquidations, alerts or disputes occur, 2) fire if there is large volatility in the synthetic or underlier price. It wont report on any wallet or CR monitoring as no params have been defined.

```bash
EMP_ADDRESS=0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1
# Be sure to replace with your mnemonic.
COMMAND=npx truffle exec ../monitor/index.js --network kovan_mnemonic
```

### Possible monitor config options

- `STARTING_BLOCK_NUMBER`[optional]: block number to search for events from. If set, acts to offset the search to ignore events in the past. If not set then default to null which indicates that the bot should start at the current block number.
- `ENDING_BLOCK_NUMBER`[optional]: block number to search for events to. If set, acts to limit from where the monitor bot will search for events up until. If not set the default to null which indicates that the bot should search up to 'latest'.
- `MEDIANIZER_PRICE_FEED_CONFIG`[optional]: enable override of the meadinizer price feed configuration. If excluded will infer from the given synthetic identifier. If provided follows the structure outlined in the common settings for the `PRICE_FEED_CONFIG`.
- `UNISWAP_PRICE_FEED_CONFIG`[optional] enable override of the uniswap price feed configuration used to monitor synthetic price difference and volatility.
- `MONITOR_CONFIG` [optional]: config contains all configuration settings for all monitor modules. This includes the following:
  - `botsToMonitor`: array of bot objects to monitor. Each bot's `botName` `address`, `CollateralThreshold` and`syntheticThreshold` must be given. Example:
    `[{ "name": "Liquidator Bot", "address": "0x12345", "collateralThreshold": x1, "syntheticThreshold": x2, "etherThreshold": x3 },..]`
  - `walletsToMonitor`: array of wallets to Monitor. Each wallet's `walletName`, `address`, `crAlert` must be given. Example: `[{ name: "Market Making bot", address: "0x12345", crAlert: 1.50 },...]`
  - `contractMonitorConfigObject` object containing two arrays of monitored liquidator and disputer bots to inform log messages in the Contract monitor. Example: `{"monitoredLiquidators": ["0x1234","0x5678"],"monitoredDisputers": ["0x1234","0x5678"] }`
  - `deviationAlertThreshold`: if deviation in token price exceeds this fire alert.
  - `volatilityWindow`: length of time (in seconds) to snapshot volatility.
  - `pegVolatilityAlertThreshold`: threshold for synthetic peg (identifier) price volatility over `volatilityWindow`.
  - `syntheticVolatilityAlertThreshold`: threshold for synthetic token on uniswap price volatility over `volatilityWindow`.
