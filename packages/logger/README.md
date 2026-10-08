# @uma/logger

@uma/logger is a specialized logger package optimized for minimal dependencies, ensuring compatibility and ease of integration.

## Installing the package

```bash
yarn add @uma/logger
```

## Importing the package

The [Logger](./src/logger) directory contains helpers and factories for logging with Winston. To get the default
logger:

```js
const { Logger } = require("@uma/logger")

// You can also log directly using the winston logger.
Logger.debug({
  at: "createPriceFeed",
  message: "Creating CryptoWatchPriceFeed",
  otherParam: 5,
})
```

## Helpers

There are two helper files that are available in logger:

- [delay.js](./src/helpers/delay.js): simple file containing a function to "sleep".

## Slack delivery and shutdown

Slack webhook posts are queued in FIFO order per webhook within a process, including across logger
instances. Each HTTP post (including message chunks) starts at least one second after the previous
post. A 429 response pauses that webhook for the full `Retry-After` interval plus up to 250 ms of jitter;
only rejected chunks are retried, at most twice. If a requested cooldown exceeds 60 seconds, the
current message and queued messages encountering more than 60 seconds of remaining cooldown are
dropped and reported through sanitized transport errors instead of delaying shutdown. The shared
webhook deadline is retained, so later messages cannot post before Slack permits. The 60-second
wait ceiling allows up to 250 ms of additional jitter. Other HTTP/network failures are not retried because
webhook delivery may already have succeeded. Requests have a 10-second timeout. Coordination across
separate bot processes still relies on Slack's rate-limit responses.

The log callback acknowledges queue admission, not remote delivery. Terminal delivery failures emit
a sanitized `TransportError` through the logger's existing error handler. Later messages continue to
be processed. Exhausted failures retain existing PagerDuty escalation; an automatically recovered
429 does not page.

Call and await `waitForLogger(logger)` before exiting. Its ordinary timeout still applies to persistent
transports, but in-memory Slack and PagerDuty V2 queues must finish their delivery attempts before it
returns. Large Slack bursts can therefore extend execution beyond `LOGGER_FLUSH_TIMEOUT`. Platform
hard deadlines or crashes can still lose in-memory messages; this is not a durable queue. PagerDuty
requests have a 30-second deadline for the entire operation, including SDK retry sleeps; reaching
the deadline rejects delivery and aborts network work. An outstanding SDK sleep may finish later,
but its aborted signal prevents another network request.

## PagerDuty incident recovery

Ordinary error logs still trigger PagerDuty. Bots can opt into one incident per operation with a
stable `pagerDutyDedupKey` (nonempty, at most 255 UTF-8 bytes). Keys must include enough chain,
contract and request identity to avoid merging unrelated failures.

After confirming completion, call `await resolvePagerDutyIncident(logger, key, notificationPath?)`.
This sends only a PagerDuty V2 resolve event through the configured route; it does not emit a new
error or Slack notification. Use the same route as the original trigger. The helper awaits prior
queued triggers, reports rejected recovery delivery, and is a no-op when no PagerDuty V2 transport
is configured. Legacy PagerDuty transports are unchanged. Bots must catch recovery-delivery errors
without treating a completed blockchain operation as unsuccessful.

Recovery notifications are collected and deduplicated during each batch, then sent after blockchain
work finishes. Delivery stops after the first PagerDuty failure in that batch, with one warning. Later
scans can retry recovery when the caller queues those keys again; callers should avoid queueing
every historical success unconditionally. This prevents an alerting outage from imposing a network
timeout before each new transaction.
