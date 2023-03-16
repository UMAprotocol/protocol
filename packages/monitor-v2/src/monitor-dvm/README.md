# DVMv2 Monitoring

## Live Monitor Bots

DVMv2 monitor bots can follow mainnet and goerli networks to report on real time events based on the provided configuration.

The main entry point to live monitor bots is running:

```
node ./packages/monitor-v2/dist/monitor-dvm/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is L1 network number (`1` for Ethereum mainnet or `5` for goerli).
- `NODE_URLS_1` or `NODE_URLS_5` is an array of L1 node URLs.
- `NODE_URL_1` or `NODE_URL_5` is a single L1 node URL. This is considered only if `NODE_URLS_1` or `NODE_URLS_5` is not provided.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
- `STARTING_BLOCK_NUMBER` and `ENDING_BLOCK_NUMBER` defines block range to look for events on L1 network. These are mandatory when `POLLING_DELAY=0`.
- `UNSTAKES_ENABLED` is boolean enabling/disabling monitoring large unstake attempts (disabled by default).
- `UNSTAKE_THRESHOLD` is UMA amount threshold to use when `UNSTAKES_ENABLED=true` (defaults to `"0"`).
- `STAKES_ENABLED` is boolean enabling/disabling monitoring large amount of UMA staked (disabled by default).
- `STAKE_THRESHOLD` is UMA amount threshold to use when `STAKES_ENABLED=true` (defaults to `"0"`).
- `GOVERNANCE_ENABLED` is boolean enabling/disabling monitoring governance proposals (disabled by default).
- `DELETION_ENABLED` is boolean enabling/disabling monitoring spam deletion proposals (disabled by default).
- `EMERGENCY_ENABLED` is boolean enabling/disabling monitoring emergency proposals (disabled by default).
- `ROLLED_ENABLED` is boolean enabling/disabling monitoring rolled votes (disabled by default).
- `GOVERNOR_TRANSFERS_ENABLED` is boolean enabling/disabling monitoring large UMA transfers out of governor (disabled by default).
- `GOVERNOR_TRANSFERS_THRESHOLD` is UMA amount threshold to use when `GOVERNOR_TRANSFERS_ENABLED=true` (defaults to `"0"`).
- `MINTS_ENABLED` is boolean enabling/disabling monitoring large UMA mints (disabled by default).
- `MINTS_THRESHOLD` is UMA amount threshold to use when `MINTS_ENABLED=true` (defaults to `"0"`).
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.

**_Note_**: all token amounts in `UNSTAKE_THRESHOLD`, `STAKE_THRESHOLD`, `GOVERNOR_TRANSFERS_THRESHOLD` and `MINTS_THRESHOLD`
parameters should be provided as number of tokens scaled down by decimals in their human readable representation.
