# Unified Optimistic Oracle Settlement Bot

The unified Optimistic Oracle bot performs off-chain actions related to multiple Oracle contract versions, specifically settling price requests that have become settleable. Supports:

- **OptimisticOracle V1** (deprecated but still deployed)
- **SkinnyOptimisticOracle** (gas-optimized version)
- **OptimisticOracle V2** (current standard)

> Warning: This bot does not support SkinnyOptimisticOracleV2. That contract has a distinct interface from SkinnyOptimisticOracle and is intentionally out of scope here.

Run via:

```
node ./packages/monitor-v2/dist/bot-oo/index.js
```

## Required Environment Variables

- `ORACLE_TYPE`: Oracle contract type (`OptimisticOracle`, `SkinnyOptimisticOracle`, or `OptimisticOracleV2`)
- `ORACLE_ADDRESS`: Address of the Oracle contract to monitor

## Standard Environment Variables

- `CHAIN_ID`: Network number.
- `NODE_URLS_X`/`NODE_URL_X`: RPC URLs for network `X`.
- `MNEMONIC`: Wallet mnemonic with funds (ignored if `GCKMS_WALLET` is set).
- `GCKMS_WALLET`: GCKMS wallet configuration to use Google Cloud KMS signer.
- `NODE_RETRIES`, `NODE_RETRY_DELAY`, `NODE_TIMEOUT`: RPC retry settings.
- `SETTLEMENTS_ENABLED`: Enable/disable settlements (`false` by default).
- `BOT_IDENTIFIER`: Application name in logs.
- `SLACK_CONFIG`: JSON with `defaultWebHookUrl`.
- `TIME_LOOKBACK`: Seconds to look back for events (default 72h).
- `MAX_BLOCK_LOOKBACK`: Max block span per query (see `blockDefaults`).
- `GAS_LIMIT_MULTIPLIER`: Percent multiplier on estimated gas (default `150`).
- `SETTLE_DELAY`: Lookback period in seconds to detect settleable requests (default `300`).
- `SETTLE_TIMEOUT`: Timeout in seconds for submitting settlement transactions in serverless mode (default `240`).

## Behavior

The bot operates with a unified dispatcher pattern:

```
settleRequests()
├── OptimisticOracle → settleOOv1Requests()
├── SkinnyOptimisticOracle → settleSkinnyOORequests()
└── OptimisticOracleV2 → settleOOv2Requests()
```

For each Oracle type:

1. Scans `RequestPrice` events within the lookback window.
2. Filters out already settled requests (`Settle` events).
3. Uses Oracle-specific logic to detect settleable requests at historical state (using `SETTLE_DELAY`).
4. Submits settlement transactions when requests are ready, stopping when `SETTLE_TIMEOUT` passes in serverless mode.
