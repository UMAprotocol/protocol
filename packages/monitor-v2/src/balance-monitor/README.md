# Account Balance Monitoring

Account balance monitor can trigger alerts based on the provided configuration whenever account balance drops below the
set threshold. Both native token and ERC-20 token balance monitoring is supported.

The main entry point to the Account balance monitor bot is running:

```
node ./packages/monitor-v2/dist/balance-monitor/index.js
```

All the configuration should be provided with following environment variables:

- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number to monitor. Monitoring
  of multiple networks is supported by passing all required `NODE_URLS_X` variables.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number to monitor. This is
  considered only if matching `NODE_URLS_X` is not provided.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running
  in serverless mode will exit after the loop.
- `MONITORED_ACCOUNTS` is an array of JSON objects each representing a single account per network to monitor, e.g.:
  ```json
  {
    "chainId": 1, // Make sure to have a matching NODE_URLS_X or NODE_URL_X.
    "address": "0x...", // Account address to monitor.
    "name": "Monitored Account", // Optional name to tag monitored account in the logs.
    "tokens": [] // An array of JSON objects each representing a single token to monitor for this account (see below).
  }
  ```
  Example format for token configuration object (passed in the `tokens` array above):
  ```json
  {
    "address": "0x...", // Optional ERC-20 contract address. If not provided, this will be monitoring native token.
    "warnThreshold": 1, // Optional threshold to log warning when balance drops below this amount (human readable).
    "errorThreshold": 0.5 // Optional threshold to log error when balance drops below this amount (human readable).
  }
  ```
