# Price Speed Up

The Price Speed Up is meant to be run in Arbitrum and Optimism. This scripts run oracleHub.requestPrice in mainnet when a dispute is raised in Arbitrum or Optimism, this mechanism short cuts the delay of relaying this message through the native bridges.

The main entry point to Price Speed Up is running:

```
node ./packages/monitor-v2/dist/price-speed-up/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is network number.
- `L2_CHAIN_ID` is network number of the L2 chain to speed up from. If provided then `NODE_URL_X` should be provided for the L2 chain.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`. This is
  considered only if matching `NODE_URLS_X` is not provided.
- `MNEMONIC` is a mnemonic for a wallet that has enough funds to pay for transactions.
- `GCKMS_WALLET` is a GCKMS wallet that has enough funds to pay for transactions. If this is provided, `MNEMONIC` is ignored.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
- `SPEED_UP_ENABLED` is boolean enabling/disabling speed up of price publishing (`false` by default).
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.
- `BLOCK_LOOKBACK` is the number of blocks to look back from the current block to look for past resolution events.
  See default values in blockDefaults in index.ts
- `MAX_BLOCK_LOOKBACK` is the maximum number of blocks to look back per query.
  See default values in blockDefaults in index.ts
