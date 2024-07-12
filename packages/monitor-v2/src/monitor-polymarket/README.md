# Polymarket Notifier

This app continuously monitors UMA Optimistic Oracle contract proposals and sends notifications based on Polymarket API information.

The Polymarket notifier looks for ProposePrice events related to the Polymarket contracts and uses the Polymarket API to fetch all active contract market prices. It compares proposed prices against the Polymarket API and notifies the user through a logging mechanism that can forward an alert to Slack or any other configured transport mechanism. Notified proposals are stored on Google Datastore, so on repeated runs the application does not notify the same proposal.

The main entry point to Polymarket notifier bot is running:

```
node ./packages/monitor-v2/dist/monitor-polymarket/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is network number.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`.
  considered only if matching `NODE_URLS_X` is not provided.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
  in serverless mode will exit after the loop.
- `THRESHOLD_ASKS` Price threshold for winner outcome asks in the orderbook that triggers a notification (defaults to `1`).
- `THRESHOLD_BIDS` Price threshold for loser outcome bids in the orderbook that triggers a notification (defaults to `0`).
- `THRESHOLD_VOLUME` Volume threshold for the market that triggers a notification (defaults to `500000`).
- `UNKNOWN_PROPOSAL_NOTIFICATION_INTERVAL` is the interval in seconds we allow to pass before notifying about a proposal event not found (defaults to `300`).
- `RETRY_ATTEMPTS` optionally specify a number to retry various external queries to polymarket. Defaults to off.
- `RETRY_DELAY_MS` optionally specify a delay in milliseconds between retries, defaults to 0 delay.
