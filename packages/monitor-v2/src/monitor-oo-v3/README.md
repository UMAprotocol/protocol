# Optimistic Oracle V3 Monitoring

Optimistic Oracle V3 monitor bots can report on real time events based on the provided configuration for all the networks
where `OptimisticOracleV3` contract is deployed.

The main entry point to Optimistic Oracle V3 monitor bots is running:

```
node ./packages/monitor-v2/dist/monitor-oo-v3/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is network number.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`. This is
  considered only if matching `NODE_URLS_X` is not provided.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running
  in serverless mode will exit after the loop.
- `STARTING_BLOCK_NUMBER` and `ENDING_BLOCK_NUMBER` defines block range to look for events on the `CHAIN_ID` network.
  These are mandatory when `POLLING_DELAY=0`.
- `ASSERTIONS_ENABLED` is boolean enabling/disabling monitoring assertions made (`false` by default).
- `DISPUTES_ENABLED` is boolean enabling/disabling monitoring disputes on assertions (`false` by default).
- `SETTLEMENTS_ENABLED` is boolean enabling/disabling monitoring settlement of assertions (`false` by default).
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.
