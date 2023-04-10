# Polymarket Notifier

This app continuously monitors UMA Optimistic Oracle contract proposals and sends notifications based on Polymarket API information.

The Polymarket notifier looks for ProposePrice events related to the Polymarket contracts and uses the Polymarket API to fetch all active contract market prices. It compares proposed prices against the Polymarket API and notifies the user through a logging mechanism that can forward an alert to Slack or any other configured transport mechanism. Notified proposals are stored on Google Datastore, so on repeated runs the application does not notify the same proposal.

The main entry point to Optimistic Governor monitor bots is running:

```
node ./packages/monitor-v2/dist/monitor-polymarket/index.js
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
- `TRANSACTIONS_PROPOSED_ENABLED` is boolean enabling/disabling monitoring transactions proposed (`false` by default).
- `THRESHOLD_TRADES` number to compare with the trades signal to trigger a notification (defaults to `0.9`).
- `THRESHOLD_ORDERS` number to compare with the orders signal to trigger a notification (defaults to `0.9`).
