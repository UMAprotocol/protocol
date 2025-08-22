# Optimistic Oracle V2 Bot

Optimistic Oracle V2 bot performs off-chain actions related to Optimistic Oracle V2 contracts, specifically settling price requests that have become settleable.

Run via:

```
node ./packages/monitor-v2/dist/bot-oo-v2/index.js
```

Environment variables (same pattern as OOv3 bot):

- `CHAIN_ID`: Network number.
- `NODE_URLS_X`/`NODE_URL_X`: RPC URLs for network `X`.
- `MNEMONIC`: Wallet mnemonic with funds (ignored if `GCKMS_WALLET` is set).
- `GCKMS_WALLET`: GCKMS wallet configuration to use Google Cloud KMS signer.
- `NODE_RETRIES`, `NODE_RETRY_DELAY`, `NODE_TIMEOUT`: RPC retry settings.
- `RUN_FREQUENCY`: Frequency in seconds (defaults to `60`).
- `SETTLEMENTS_ENABLED`: Enable/disable settlements (`false` by default).
- `BOT_IDENTIFIER`: Application name in logs.
- `SLACK_CONFIG`: JSON with `defaultWebHookUrl`.
- `TIME_LOOKBACK`: Seconds to look back for events (default 72h).
- `MAX_BLOCK_LOOKBACK`: Max block span per query (see `blockDefaults`).
- `GAS_LIMIT_MULTIPLIER`: Percent multiplier on estimated gas (default `150`).

Behavior:

- Scans `RequestPrice` events within the lookback window.
- Filters out already settled requests (`Settle` events).
- Uses a static call to `settle` to detect settleable requests, then submits settlement transactions.
