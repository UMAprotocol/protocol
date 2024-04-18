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

export abstract class PersistentTransport extends Transport {
  protected readonly rateLimit: number = 0; // Derived implementation would override rate limits if required.

  private isQueueBeingExecuted = false;
  private canProcess = true;

  private redis: _RedisClient;
  private readonly logListKey: string;

  constructor(winstonOpts: TransportOptions, protected readonly derivedTransport: string) {
    super(winstonOpts);

    const url = process.env.REDIS_URL || redisDefaultUrl;
    // Pass redis errors to console. We don't want this to emit an error log, since these are normally connection
    // errors unrelated to a particular request.
    this.redis = createClient({ url }).on("error", (err) => console.error("Redis error", err));

    const botIdentifier = process.env.BOT_IDENTIFIER || noBotId;
    this.logListKey = `uma-persistent-log-queue:${botIdentifier}:${derivedTransport}`;

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
        await this.connectRedis();

        const oldestLogString = await this.redis.lPop(this.logListKey);
        if (oldestLogString === null) break; // We have processed all logs from persistent storage queue.

        info = JSON.parse(oldestLogString);
        if (!isDictionary(info)) throw new Error("Unsupported info type!");

        // Log the message in the derived transport implementation.
        await this.logQueueElement(info);
      } catch (error) {
        if (info === null) {
          // We cannot emit TransportError as we don't have access to original info object yet.
          this.emit("error", error);
        } else this.emit("error", new TransportError(this.derivedTransport, error, info));
        break;
      }

      // Wait before processing the next message if the implementation requires any rate limiting.
      await delay(this.rateLimit);
    }

    // Unblock any pauseProcessing call that waits for current log element being processed.
    this.emit("processed"); // This should also unlock the queue execution in the listener.
  }

  // Connect to redis when not ready.
  private async connectRedis(): Promise<void> {
    if (!this.redis.isReady) await this.redis.connect();
  }
}
