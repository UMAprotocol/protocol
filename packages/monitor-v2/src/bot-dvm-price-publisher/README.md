# Optimistic Oracle V3 Bot

Optimistic Oracle V3 bots can run off-chain actions related to Optimistic Oracle V3 contracts.

The main entry point to Optimistic Oracle V3 monitor bots is running:

```
node ./packages/monitor-v2/dist/bot-oo-v3/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is network number.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`. This is
  considered only if matching `NODE_URLS_X` is not provided.
- `MNEMONIC` is a mnemonic for a wallet that has enough funds to pay for transactions.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `RUN_FREQUENCY` is the frequency in seconds at which the bot should run (defaults to `60`).
- `SETTLEMENTS_ENABLED` is boolean enabling/disabling settlement of assertions (`false` by default).
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.
