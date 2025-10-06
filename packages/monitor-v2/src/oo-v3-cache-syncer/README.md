# Optimistic Oracle V3 Cache Syncer

The Optimistic Oracle V3 Cache Syncer monitors and synchronizes cached parameters in Optimistic Oracle V3 contracts to ensure they stay in sync with the current state of UMA protocol parameters. It checks and updates:

- **Oracle Implementation**: Ensures the cached oracle address matches the current oracle from the Finder
- **Collateral Parameters**: Syncs whitelist status and final fees for all collaterals
- **Identifier Parameters**: Syncs whitelist status for all supported identifiers

The main entry point to the Optimistic Oracle V3 Cache Syncer is running:

```
node ./packages/monitor-v2/dist/oo-v3-cache-syncer/index.js
```

## Required Environment Variables

- `CHAIN_ID`: Network number.
- `NODE_URLS_X`/`NODE_URL_X`: RPC URLs for network `X`.
- `MNEMONIC`: Wallet mnemonic with funds (ignored if `GCKMS_WALLET` is set).
- `GCKMS_WALLET`: GCKMS wallet configuration to use Google Cloud KMS signer.

## Standard Environment Variables

- `NODE_RETRIES`: Number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY`: Delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT`: Timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY`: Value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
- `SUBMIT_SYNC_TX`: Boolean enabling/disabling sync transaction submission (`true` by default). When `false`, the bot will only log out-of-sync parameters without submitting transactions.
- `BOT_IDENTIFIER`: Application name in logs.
- `SLACK_CONFIG`: JSON with `defaultWebHookUrl`.
- `MAX_BLOCK_LOOKBACK`: Maximum block span per query (see `blockDefaults`).
- `GAS_LIMIT_MULTIPLIER`: Percent multiplier on estimated gas (default `150`).
- `MULTICALL_ADDRESS`: Address of the Multicall3 contract (defaults to Ethereum mainnet address `0xcA11bde05977b3631167028862bE2a173976CA11`).

## Behavior

The bot operates with a systematic synchronization approach:

```
syncOOv3Cache()
├── syncOracle() → Checks and syncs oracle implementation
├── syncCollaterals() → Checks and syncs collateral parameters
└── syncIdentifiers() → Checks and syncs identifier parameters
```

For each parameter type:

1. **Oracle Sync**: Compares cached oracle address with current oracle from Finder contract
2. **Collateral Sync**:
   - Fetches all collaterals ever added to AddressWhitelist
   - Compares current whitelist status and final fees with cached values
   - Batches sync transactions for out-of-sync collaterals
3. **Identifier Sync**:
   - Fetches all identifiers ever added to IdentifierWhitelist
   - Compares current support status with cached values
   - Batches sync transactions for out-of-sync identifiers

The bot uses multicall transactions to efficiently batch multiple sync operations when multiple parameters are out of sync.
