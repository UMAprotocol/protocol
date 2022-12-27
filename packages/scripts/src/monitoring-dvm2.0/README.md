# DVMv2 Monitoring

## Live Monitor Bots

DVMv2 monitor bots can follow mainnet and goerli to report on real time events based on provided configuration.

The main entry point to live monitor bots is running:

```
yarn ts-node packages/scripts/src/monitoring-dvm2.0/index.ts
```

All the configuration should be provided with following environment variables:

- `CUSTOM_NODE_URL` is L1 network node endpoint (Ethereum mainnet or goerli);
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
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.
