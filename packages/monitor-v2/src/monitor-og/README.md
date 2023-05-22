# Optimistic Governor Monitoring

Optimistic Governor monitor bots can report on real time events based on the provided configuration for all the networks
where `OptimisticGovernor` contract is deployed.

The main entry point to Optimistic Governor monitor bots is running:

```
node ./packages/monitor-v2/dist/monitor-og/index.js
```

All the configuration should be provided with following environment variables:

- `OG_MASTER_COPY_ADDRESSES` is an array of addresses of the deployed Optimistic Governor master copies used to discover
  new deployments of Optimistic Governor proxies (defaults to protocol deployments)
- `MODULE_PROXY_FACTORY_ADDRESSES` is an array of addresses of the deployed Module Proxy Factory used to discover new
  deployments of Optimistic Governor proxies (defaults to the latest Zodiac deployments).
- Following mutually exclusive variables are used to determine which Optimistic Governor contract to monitor. If none
  of them is provided then the bot will monitor all the Optimistic Governor contracts deployed through any of factory
  contracts provided in `MODULE_PROXY_FACTORY_ADDRESSES` and using any of master copies provided in
  `OG_MASTER_COPY_ADDRESSES`.
  - `OG_ADDRESS` is the address of the deployed Optimistic Governor that this bot will monitor.
  - `OG_WHITELIST` is an array of addresses of the deployed Optimistic Governor that this bot will monitor. All of them
    must be deployed through any of factory contracts provided in `MODULE_PROXY_FACTORY_ADDRESSES` and using any of
    master copies provided in `OG_MASTER_COPY_ADDRESSES`.
  - `OG_BLACKLIST` is an array of addresses of the deployed Optimistic Governor that this bot will not monitor. All of
    them must be deployed through any of factory contracts provided in `MODULE_PROXY_FACTORY_ADDRESSES` and using any
    of master copies provided in `OG_MASTER_COPY_ADDRESSES`.
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
- `TRANSACTIONS_EXECUTED_ENABLED` is boolean enabling/disabling monitoring transactions executed (`false` by default).
- `PROPOSAL_EXECUTED_ENABLED` is boolean enabling/disabling monitoring proposal executed (`false` by default).
- `PROPOSAL_DELETED_ENABLED` is boolean enabling/disabling monitoring proposal deleted (`false` by default).
- `SET_COLLATERAL_BOND_ENABLED` is boolean enabling/disabling monitoring set collateral and bond amount (`false` by default).
- `SET_RULES_ENABLED` is boolean enabling/disabling monitoring set rules (`false` by default).
- `SET_LIVENESS_ENABLED` is boolean enabling/disabling monitoring set liveness (`false` by default).
- `SET_IDENTIFIER_ENABLED` is boolean enabling/disabling monitoring set identifier (`false` by default).
- `SET_ESCALATION_MANAGER_ENABLED` is boolean enabling/disabling monitoring set escalation manager (`false` by default).
- `PROXY_DEPLOYED_ENABLED` is boolean enabling/disabling monitoring new proxy deployements (`false` by default).
