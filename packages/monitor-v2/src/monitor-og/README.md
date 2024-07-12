# Optimistic Governor Monitoring

Optimistic Governor monitor bots can report on real time events based on the provided configuration for all the networks
where `OptimisticGovernor` contract is deployed.

The main entry point to Optimistic Governor monitor bots is running:

```
node ./packages/monitor-v2/dist/monitor-og/index.js
```

All the configuration should be provided with following environment variables:

- `OG_MASTER_COPY_ADDRESSES` is an array of addresses of the deployed Optimistic Governor master copies used to discover
  new deployments of Optimistic Governor proxies. This defaults to the latest protocol deployment if not provided. Users
  need to provide this only if they want to monitor Optimistic Governor contracts deployed with older versions of the
  mastercopy.
- `MODULE_PROXY_FACTORY_ADDRESSES` is an array of addresses of the deployed Module Proxy Factory used to discover new
  deployments of Optimistic Governor proxies. This defaults to the latest Zodiac deployment if not provided. Users need
  to provide this only if they want to monitor Optimistic Governor contracts deployed with older versions of the module
  proxy factory.
- Following mutually exclusive variables are used to determine which Optimistic Governor contract to monitor. If none
  of them is provided then the bot will monitor all the Optimistic Governor contracts deployed through factory.
  - `OG_ADDRESS` is the address of the deployed Optimistic Governor that this bot will monitor. This does not
    necessarily need to be deployed through factory.
  - `OG_WHITELIST` is an array of addresses of the deployed Optimistic Governor that this bot will monitor. All of them
    must be deployed through factory and mastercopy being monitored.
  - `OG_BLACKLIST` is an array of addresses of the deployed Optimistic Governor that this bot will not monitor. All of
    them must be deployed through factory and mastercopy being monitored.
- `CHAIN_ID` is network number.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`. This is
  considered only if matching `NODE_URLS_X` is not provided.
- `GCKMS_WALLET` is a GCKMS wallet used to submit transactions in any of automated support modes. If this is provided,
  `MNEMONIC` is ignored.
- `MNEMONIC` is a mnemonic for a wallet used to submit transactions in any of automated support modes.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running
  in serverless mode will exit after the loop.
- `STARTING_BLOCK_NUMBER` and `ENDING_BLOCK_NUMBER` defines block range to look for events on the `CHAIN_ID` network.
  These are mandatory when `POLLING_DELAY=0`.
- `TRANSACTIONS_PROPOSED_ENABLED` is boolean enabling/disabling monitoring transactions proposed (`false` by default).
- `TRANSACTIONS_EXECUTED_ENABLED` is boolean enabling/disabling monitoring transactions executed (`false` by default).
- `PROPOSAL_EXECUTED_ENABLED` is boolean enabling/disabling monitoring proposal executed (`false` by default).
- `PROPOSAL_DELETED_ENABLED` is boolean enabling/disabling monitoring proposal deleted (`false` by default).
- `SET_COLLATERAL_BOND_ENABLED` is boolean enabling/disabling monitoring set collateral and bond amount (`false` by default).
- `SET_RULES_ENABLED` is boolean enabling/disabling monitoring set rules (`false` by default).
- `SET_LIVENESS_ENABLED` is boolean enabling/disabling monitoring set liveness (`false` by default).
- `SET_IDENTIFIER_ENABLED` is boolean enabling/disabling monitoring set identifier (`false` by default).
- `SET_ESCALATION_MANAGER_ENABLED` is boolean enabling/disabling monitoring set escalation manager (`false` by default).
- `PROXY_DEPLOYED_ENABLED` is boolean enabling/disabling monitoring new proxy deployments (`false` by default).
- `AUTOMATIC_PROPOSALS_ENABLED` is boolean enabling/disabling automatic proposal submission on supported oSnap modules
  (`false` by default). This mode requires setting supported bond values in `SUPPORTED_BONDS` and either `GCKMS_WALLET`
  or `MNEMONIC` for signing proposal transactions.
- `AUTOMATIC_DISPUTES_ENABLED` is boolean enabling/disabling automatic disputes of supported oSnap proposals (`false` by
  default). This mode requires setting supported bond values in `SUPPORTED_BONDS` and either `GCKMS_WALLET` or
  `MNEMONIC` for signing dispute transactions.
- `AUTOMATIC_EXECUTIONS_ENABLED` is boolean enabling/disabling automatic execution of supported oSnap proposals (`false`
  by default). This mode requires setting supported bond values in `SUPPORTED_BONDS` and either `GCKMS_WALLET` or
  `MNEMONIC` for signing execution transactions.
- `NOTIFY_NEW_PROPOSALS_ENABLED` is boolean enabling/disabling notification of new proposals (`false` by default).
- `DISPUTE_IPFS_SERVER_ERRORS` is boolean enabling/disabling automatic dispute of proposals with IPFS server errors
  (`false` by default). This is used only in conjunction with `AUTOMATIC_DISPUTES_ENABLED` set to `true`.
- `ASSERTION_BLACKLIST` is an array of assertion IDs that should be ignored when submitting disputes or trying to
  execute. This is used only in conjunction with `AUTOMATIC_DISPUTES_ENABLED` or `AUTOMATIC_EXECUTIONS_ENABLED` set to
  `true`.
- `SUPPORTED_BONDS` is a mapping of supported bond tokens and bond values. This is required when running in automated
  support mode. Only oSnap modules with exact match of bond token and bond value will be supported.
- `SUBMIT_AUTOMATION` is boolean enabling/disabling transaction submission in any of automated support modes (`true` by
  default). If this is set to `false`, the bot will only simulate transaction submission and log the results. Note that
  bond approval transactions would be still submitted as they are required for the subsequent proposal/dispute
  simulation.
- `AUTOMATIC_EXECUTION_GAS_LIMIT` is the gas limit imposed on automated transaction execution. Transactions requiring
  more gas will not be submitted. This is used only in conjunction with `AUTOMATIC_EXECUTIONS_ENABLED` set to `true`. If
  not provided, this defaults to `500000`.
- `SNAPSHOT_ENDPOINT` is the Snapshot endpoint used to verify Snapshot proposals. If not provided, this defaults to
  `https://snapshot.org`.
- `GRAPHQL_ENDPOINT` is the GraphQL endpoint used to verify Snapshot proposals. If not provided, this defaults to
  `https://hub.snapshot.org/graphql`.
- `IPFS_ENDPOINT` is the IPFS endpoint used to verify Snapshot proposals. If not provided, this defaults to
  `https://cloudflare-ipfs.com/ipfs`.
- `APPROVAL_CHOICES` is the list of choices representing approval of Snapshot proposals. If no choice in the proposal
  corresponds to any of possible approval choices in this list, the bot will not be able to verify Snapshot proposal and
  log an error. If not provided, this variable defaults to `["Yes", "For", "YAE"]`.
- `SNAPSHOT_RETRIES` is the number of maximum retries when trying to fetch IPFS and GraphQL data for Snapshot
  verification. If not provided, this defaults to 3.
- `SNAPSHOT_TIMEOUT` is the number of milliseconds to wait before starting the first retry when trying to fetch IPFS and
  GraphQL data for Snapshot verification. If not provided, this defaults to 1000. After the first retry, this does
  exponential backoff (using a factor of 2).
- `STORAGE` is the storage type used to keep state on notified Snapshot proposals. If not provided, this defaults to
  `datastore`. Supported values are `datastore` (Google Datastore) and `file` (local file system).
- `TENDERLY_USER`, `TENDERLY_PROJECT` and `TENDERLY_ACCESS_KEY` are used to simulate proposed transaction execution on
  Tenderly. If any of these are missing, the bot will skip the simulation.
- `REPROPOSE_DISPUTED` is a boolean indicating whether to re-propose disputed proposals. Defaults to `false`.
