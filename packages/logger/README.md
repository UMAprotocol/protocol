# @uma/logger

@uma/logger is a specialized logger package optimized for minimal dependencies, ensuring compatibility and ease of integration.

## PagerDuty incident recovery

Ordinary error logs still trigger PagerDuty. Bots can opt into one incident per operation with a
stable `pagerDutyDedupKey` (nonempty, at most 255 UTF-8 bytes). Include chain, contract, and request
identity to avoid combining unrelated failures.

After confirming completion, await `resolvePagerDutyIncident(logger, key, notificationPath?)` using
the same route as the trigger. This sends only a PagerDuty V2 resolve event, waits for prior queued
triggers, and rejects failed delivery. Waiting for upstream logger buffers is bounded to 30 seconds
so a stalled unrelated transport cannot block the bot indefinitely. It is a no-op when no PagerDuty V2 transport is configured.
Legacy PagerDuty transports retain their behavior. Catch recovery failures without treating a
completed blockchain operation as unsuccessful.

`PagerDutyRecoveryBatch` collects and deduplicates confirmed recoveries during blockchain work, then
sends them after the batch. The first delivery failure stops the remaining recovery notifications
for that batch. A later flush can retry retained keys while that batch object remains alive; bots
that skip historical completions can require manual incident reconciliation after a restart.

PagerDuty V2 callbacks acknowledge queue admission; asynchronous delivery failures use the existing
transport error handler. Events sharing a routing key and deduplication key are ordered. HTTP
rejections are checked, and each SDK call is bounded by a 30-second deadline that also aborts fetch.
The deadline covers the SDK's retry sleeps.

Await `waitForLogger(logger)` before exiting. At `LOGGER_FLUSH_TIMEOUT`, persistent queue processing
is paused and any already-dequeued record is allowed to finish. After that, in-memory transports
with a `flush()` method get up to `LOGGER_MANDATORY_FLUSH_TIMEOUT` additional seconds (default 120)
to drain. PagerDuty V2 uses this window for pending events. Notifications are reported to the console
if the window expires and can be lost at process exit.
Allow for the additional wait in execution deadlines. Stable incident keys do not automatically
resolve older unkeyed incidents.

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
