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
instances. Each HTTP post, including split-message chunks, starts at least one second after the
previous post. HTTP 429 responses impose a shared `Retry-After` cooldown plus up to 250 ms of jitter;
only rejected chunks are retried, at most twice. Successful earlier chunks are never replayed.
Network failures and other HTTP errors are not retried because delivery may already have succeeded.
Requests have a 10-second timeout.

Cooldowns over 60 seconds drop and report the affected message instead of holding the bot indefinitely.
Queued messages encountering more than 60 seconds of remaining cooldown are also dropped. The shared
deadline is retained so later messages cannot post before Slack permits. Separate bot processes still
rely on Slack's rate-limit responses; the queue is not distributed or durable.

The transport callback acknowledges queue admission. Terminal failures emit a sanitized transport
error through the existing error handler, while later messages continue processing. Recovered 429s
do not page; exhausted delivery failures retain the existing PagerDuty escalation.

Await `waitForLogger(logger)` before exiting. At the ordinary `LOGGER_FLUSH_TIMEOUT`, persistent
queue processing is paused and any already-dequeued record is allowed to finish. Remaining records
stay persisted while Slack drains. After that, in-memory
transports with a `flush()` method get up to `LOGGER_MANDATORY_FLUSH_TIMEOUT` additional seconds
(default 120) to drain, including Winston's buffered writes. Slack uses this window for queued webhook posts. If
the window expires, remaining notifications are reported to the console and may be lost when the
process exits.
Ensure the bot's execution deadline allows for this additional wait. Crashes and platform hard
deadlines can still lose queued messages.

The contract notifier, Polymarket notifier, legacy optimistic-oracle bot, monitor error path, and
Fx tunnel relayer CLI await this drain before process exit. Existing five-second grace periods are
retained for transports that do not expose a flush signal. This changes shutdown delivery only;
transaction submission and polling behavior are unchanged.
