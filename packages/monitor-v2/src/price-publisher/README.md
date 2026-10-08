# Price Publisher

The Price Publisher is responsible for publishing the prices resolved in the DVM to the requester layer two chains.

The main entry point to Price Publisher is running:

```
node ./packages/monitor-v2/dist/price-publisher/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is network number.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`. This is
  considered only if matching `NODE_URLS_X` is not provided.
- `MNEMONIC` is a mnemonic for a wallet that has enough funds to pay for transactions.
- `GCKMS_WALLET` is a GCKMS wallet that has enough funds to pay for transactions. If this is provided, `MNEMONIC` is ignored.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
- `PUBLISH_ENABLED` is boolean enabling/disabling price publishing (`false` by default).
- `RESOLVE_ENABLED` is boolean enabling/disabling price resolving (`false` by default).
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL.
- `BLOCK_LOOKBACK`(Optional) is the number of blocks to look back from the current block to look for past resolution events.
  See default values in blockDefaults in index.ts
- `MAX_BLOCK_LOOKBACK`(Optional) is the maximum number of blocks to look back per query.
  See default values in blockDefaults in index.ts

### Transaction recovery and paging

When both modes are enabled, the resolution phase completes before publication starts. Individual
publication failures do not prevent later requests from being attempted. After processing the batch,
any unsuccessful requests cause a nonzero exit; their per-request incidents replace the duplicate
batch error page. Setup, RPC scan and resolution-phase failures still page at the execution level.

Resolution and publication retry only explicit nonce-too-low / replacement-underpriced submission
rejections, with at most three total attempts and 15s/30s backoff plus up to 250ms jitter. Each publication
attempt rechecks `PushedPrice` and fetches a fresh pending nonce. Receipt waiting occurs after the
retry block: timeouts, reverts, already-known transactions and uncertain broadcasts never cause an
automatic resubmission. A publication observed on-chain after an error is treated as recovered.

Persistent publication failures use stable PagerDuty keys containing source chain, destination oracle
and request hash. Recovery is queued only when this invocation attempted publication and then
confirmed completion through a receipt or matching `PushedPrice` event. Requests already published
before any submission attempt are skipped without sending PagerDuty resolves on every scan.
A failed recovery notification logs a warning. If a previous process failed and another sender
completed the request before this process attempted it, or recovery delivery failed, its incident
may require manual reconciliation; historical scans do not replay resolves. A request that ages out
of `BLOCK_LOOKBACK` is likewise not presumed recovered. Wallet configuration is unchanged; other
processes can still race for the same nonce. The bounded retries mitigate that contention but do
not provide cross-process nonce allocation.

This does not introduce a 30-minute suppression window or reduce pages for unknown errors: a failure
that survives the bounded retry attempts still escalates.

Recovery notifications are collected and deduplicated during each batch, then sent after blockchain
work finishes. Delivery stops after the first PagerDuty failure in that batch, with one warning. This
prevents an alerting outage from imposing a network timeout before each new transaction.
