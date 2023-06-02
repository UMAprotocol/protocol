# Price Publisher

The Price Publisher is responsible for publishing the prices resolved in the DVM to the requester layer two chains.

The main entry point to Price Publisher is running:

```
node ./packages/monitor-v2/dist/price-publisher/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is network number.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`. This is
  considered only if matching `NODE_URLS_X` is not provided.
- `MNEMONIC` is a mnemonic for a wallet that has enough funds to pay for transactions.
- `GCKMS_WALLET` is a GCKMS wallet that has enough funds to pay for transactions. If this is provided, `MNEMONIC` is ignored.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
- `PUBLISH_ENABLED` is boolean enabling/disabling price publishing (`false` by default).
- `RESOLVE_ENABLED` is boolean enabling/disabling price resolving (`false` by default).
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.
- `BLOCK_LOOKBACK`(Optional) is the number of blocks to look back from the current block to look for past resolution events.
  See default values in blockDefaults in index.ts
- `MAX_BLOCK_LOOKBACK`(Optional) is the maximum number of blocks to look back per query.
  See default values in blockDefaults in index.ts
