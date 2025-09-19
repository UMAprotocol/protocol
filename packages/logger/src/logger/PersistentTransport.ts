// This transport stores log info to Redis cache. It is intended to be used as base class for other transports to manage
// their log queue. Persistent queue management is required when transport is rate limiting and otherwise would not be
// able to process all memory queue messages within its run cycle (e.g. Discord Ticketing).
import { createClient } from "redis";
import Transport from "winston-transport";

import { noBotId, redisDefaultUrl } from "../constants";
import { delay } from "../helpers/delay";
import { isDictionary } from "../helpers/typeGuards";
import { TransportError } from "./TransportError";

type _RedisClient = ReturnType<typeof createClient>;

type TransportOptions = ConstructorParameters<typeof Transport>[0];

// Lua script returns an array with the first element being the status of the operation and the second element being
// the oldest popped item if the status is 'ready', or false if the status is 'locked' or 'empty'. The helper function
// would convert this array to a dictionary object with 'status' and 'item' properties for easier handling in the code.
type RateLimitedPopResult = { status: "ready"; item: string } | { status: "locked" } | { status: "empty" };
type ArrayFromResult<T extends { status: string }> = T extends { item: infer I }
  ? [T["status"], I]
  : [T["status"], null];
type RateLimitedPopResultArray = ArrayFromResult<RateLimitedPopResult>;

export abstract class PersistentTransport extends Transport {
  protected readonly rateLimit: number = 0; // Derived implementation would override rate limits (in seconds) if required.

  private isQueueBeingExecuted = false;
  private canProcess = true;

  private redis: _RedisClient;
  private readonly logListKey: string;
  private readonly rateLimitKey: string;

  // TODO: Remove this when the previous botIdentifier log queue is fully processed for bots that have been moved to use
  // the shared log queue.
  private readonly legacyLogListKey: string;

  private readonly redisPollingInterval = 0.25; // Interval in seconds to poll Redis for new log messages to process.

  // Lua script for passing to Redis to enforce global rate limiting. It uses a TTL-based cooldown mechanism to ensure
  // that only one worker can pop from the queue at a time, and it waits for the cooldown period before allowing another
  // worker to pop from the queue. The workers are expected to process queue elements only using this script and not
  // directly using LPOP or similar commands.
  // The script returns an array with the first element being the status of the operation:
  // - 'ready' if an item was successfully popped from the queue,
  // - 'locked' if someone has recently processed an element and the cooldown period is still active,
  // - 'empty' if the queue is empty and the rate limit key was released.
  // The second element is the popped item if the status is 'ready', or false if the status is 'locked' or 'empty'.
  // Note that this intentionally uses false instead of nil to avoid array truncation by redis.
  private readonly RATE_LIMIT_POP_LUA = `
    -- KEYS[1] = rate_limit key (TTL-based cooldown)
    -- KEYS[2] = queue list key
    -- ARGV[1] = cooldown TTL in ms

    local got_token = redis.call('SET', KEYS[1], '1', 'NX', 'PX', ARGV[1])
    if not got_token then
      return { 'locked', false }
    end

    local item = redis.call('LPOP', KEYS[2])
    if item then
      return { 'ready', item }
    else
      -- queue empty; release immediately so others don't wait the TTL
      redis.call('DEL', KEYS[1])
      return { 'empty', false }
    end
  `;

  constructor(
    winstonOpts: TransportOptions,
    protected readonly derivedTransport: string,
    protected readonly sharedLogQueue?: string
  ) {
    super(winstonOpts);

    const url = process.env.REDIS_URL || redisDefaultUrl;
    // Pass redis errors to console. We don't want this to emit an error log, since these are normally connection
    // errors unrelated to a particular request.
    this.redis = createClient({ url }).on("error", (err) => console.error("Redis error", err));

    const botIdentifier = process.env.BOT_IDENTIFIER || noBotId;
    this.legacyLogListKey = `uma-persistent-log-queue:${botIdentifier}:${derivedTransport}`;

    // Shared log queue can be used across multiple bots to enforce global rate limiting per transport.
    // If sharedLogQueue is not provided, we use botIdentifier to scope the queue to the individual bot.
    const queueScope =
      sharedLogQueue === undefined ? `${botIdentifier}:${derivedTransport}` : `${sharedLogQueue}:${derivedTransport}`;
    this.logListKey = `uma-persistent-log-queue:${queueScope}`;
    this.rateLimitKey = `uma-persistent-log-rate-limit:${queueScope}`;

    this.on("processed", () => (this.isQueueBeingExecuted = false)); // Unlock queue execution when current run processed.
  }

  // Getter for checking if the transport is flushed.
  get isFlushed(): boolean {
    return !this.isQueueBeingExecuted;
  }

  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: (error?: unknown) => void): Promise<void> {
    try {
      // We only support persisting dictionary object logs.
      if (!isDictionary(info)) throw new Error("Unsupported info type!");

      await this.connectRedis();

      await this.redis.rPush(this.logListKey, JSON.stringify(info));
    } catch (error) {
      return callback(new TransportError(this.derivedTransport, error, info));
    }
    // Initiate log queue processing. We don't await it as this should run in background and it is controlled externally
    // via pauseProcessing method.
    this.processLogQueue();

    callback();
  }

  // Signal to pause processing messages from persistent storage.
  async pauseProcessing() {
    this.canProcess = false;

    // Wait to log for currently processed element.
    if (this.isQueueBeingExecuted) {
      await new Promise((resolve) => {
        this.once("processed", resolve);
      });
    }
  }

  // Logs queue element when processing persistent storage. Implementation is specific to derived class.
  abstract logQueueElement(info: Record<string, unknown>): Promise<void>;

  // Processes log queue from persistent storage.
  async processLogQueue(): Promise<void> {
    // Avoid concurrent log queue processing and lock it.
    if (this.isQueueBeingExecuted) return;
    this.isQueueBeingExecuted = true;

    // We will need access to info in catch block for more verbose error handling.
    let info: Record<string, unknown> | null;

    // Process queue unless received signal to pause before termination.
    while (this.canProcess) {
      info = null; // Reset info at the beginning of each iteration.

      try {
        const result = await this.rateLimitedPopWithStatus();

        if (result.status === "empty") break; // We have processed all logs from persistent storage queue.

        if (result.status === "ready") {
          info = JSON.parse(result.item);
          if (!isDictionary(info)) throw new Error("Unsupported info type!");

          // Log the message in the derived transport implementation.
          await this.logQueueElement(info);

          // Process the next message in the queue. Rate limiting is handled by the Lua script.
          continue;
        }
      } catch (error) {
        if (info === null) {
          // We cannot emit TransportError as we don't have access to original info object yet.
          this.emit("error", error);
        } else this.emit("error", new TransportError(this.derivedTransport, error, info));
        break;
      }

      // Status must have been locked, wait small delay before processing the next message to avoid hammering Redis.
      await delay(this.redisPollingInterval);
    }

    // Unblock any pauseProcessing call that waits for current log element being processed.
    this.emit("processed"); // This should also unlock the queue execution in the listener.
  }

  // Connect to redis when not ready.
  private async connectRedis(): Promise<void> {
    if (!this.redis.isReady) await this.redis.connect();
  }

  // Rate limited pop from Redis list. It uses Lua script to ensure that only one worker can pop from the list at a
  // time, and it waits for the cooldown period before allowing another worker to pop from the list.
  private async rateLimitedPopWithStatus(): Promise<RateLimitedPopResult> {
    await this.connectRedis();

    // TODO: Remove the legacy queue when it is fully processed for bots that have been moved to use the shared log queue.
    // For now process the legacy queue first, then the shared log queue if the old one is empty.
    const logListKey = (await this.redis.lLen(this.legacyLogListKey)) === 0 ? this.logListKey : this.legacyLogListKey;

    // node-redis returns arrays for Lua tables and RESP2 converts false elements to null.
    const [status, item] = (await this.redis.eval(this.RATE_LIMIT_POP_LUA, {
      keys: [this.rateLimitKey, logListKey],
      arguments: [String(this.rateLimit * 1000)], // Lua script expects TTL in milliseconds.
    })) as RateLimitedPopResultArray;

    return status === "ready" ? { status, item } : { status };
  }
}
