# @uma/across-monitor

This package contains Across bridge pool monitor bot checking for key events.

## Environment variables

The Across bridge pool monitor uses following environment variables:

- `BRIDGE_ADMIN_CHAIN_ID` is chain id for L1 network where Across bridge pools should be monitored, defaults to Ethereum mainnet (1).
- `UTILIZATION_ENABLED` is boolean enabling/disabling monitoring Across bridge pool utilization.
- `UTILIZATION_THRESHOLD` is number in percent threshold on the minimum pool utilization when to fire notifications.
- `UNKNOWN_RELAYS_ENABLED` is boolean enabling/disabling monitoring non-whitelisted address calls on any relay related method.
- `WHITELISTED_ADDRESSES` is an array of known relayer addresses that should not be monitored for relay events.
- `CUSTOM_NODE_URL` is L1 network node endpoint.
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
- `STARTING_BLOCK_NUMBER` and `ENDING_BLOCK_NUMBER` defines block range to look for events on L1 network.
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `ERROR_RETRIES` is number of times to retry failed operation (e.g. due to API not responding). It defaults to 3 re-tries on error within the execution loop.
- `ERROR_RETRIES_TIMEOUT` is time in seconds between re-tries, defaulting to 1 second.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.

## Running Across bridge pool monitor

From UMA [protocol repository](https://github.com/UMAprotocol/protocol/) install dependancies and build:

```
yarn
yarn qbuild
```

Then run the Across monitor bot (with environment variables set in `.env` file):

```
node ./packages/across-monitor/dist/src/index.js --network mainnet_mnemonic
```
