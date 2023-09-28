# LLM Dispute Bot

The LLM Dispute Bot can check for disputable requests with LLM logic and dispute them.

The main entry point to LLM Dispute Bot is running:

```
node ./packages/llm-bot/dist/dispute-bot/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is network number.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`. This is considered only if matching `NODE_URLS_X` is not provided.
- `MNEMONIC` is a mnemonic for a wallet that has enough funds to pay for transactions.
- `GCKMS_WALLET` is a GCKMS wallet that has enough funds to pay for transactions. If this is provided, `MNEMONIC` is ignored.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
- `DISPUTE_DISPUTABLE_REQUESTS` is boolean enabling/disabling disputes with LLM bot (`false` by default).
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.
- `BLOCK_LOOKBACK` is the number of blocks to look back from the current block to look for past resolution events.
  See default values in blockDefaults in index.ts
- `MAX_BLOCK_LOOKBACK` is the maximum number of blocks to look back per query.
  See default values in blockDefaults in index.ts
