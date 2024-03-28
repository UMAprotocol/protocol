// This transport stores log info to persistent GCP Datastore. It is intended to be used as base class for other
// transports to manage their log queue. Persistent queue management is required when transport is rate limiting and
// otherwise would not be able to process all memory queue messages within its run cycle (e.g. Discord Ticketing).
import { Datastore, Key, PropertyFilter, and } from "@google-cloud/datastore";
import Transport from "winston-transport";

import { delay } from "../helpers/delay";
import { isDictionary } from "./Logger";
import { TransportError } from "./TransportError";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

export type LogEntity = {
  logId: number;
  botIdentifier: string;
  transport: string;
  info: Record<string, unknown>;
};

type LogEntityAndKey = {
  logEntity: LogEntity;
  logEntityKey: Key;
};

// Type guard for log entities.
export function isLogEntity(data: unknown): data is LogEntity {
  if (!isDictionary(data)) return false;
  return (
    typeof data.logId === "number" &&
    typeof data.botIdentifier === "string" &&
    typeof data.transport === "string" &&
    isDictionary(data.info)
  );
}

export abstract class DatastoreTransport extends Transport {
  protected datastore: Datastore;
  protected readonly kind = "PersistentLogQueue"; // Kind name in Datastore.
  protected readonly botIdentifier: string;
  protected readonly rateLimit: number = 0; // Derived implementation would override rate limits if required.

  private idSuffixCounter = 0;
  private lastTimestamp = 0;
  private isQueueBeingExecuted = false;
  private canProcess = true;

  constructor(winstonOpts: TransportOptions) {
    super(winstonOpts);

    this.datastore = new Datastore();
    this.botIdentifier = process.env.BOT_IDENTIFIER || "NO_BOT_ID";
  }

  abstract get transport(): string; // Derived transport should return its name for any TransportError logs.

  // Getter for checking if the transport is flushed.
  get isFlushed(): boolean {
    return !this.isQueueBeingExecuted;
  }

  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: (error?: unknown) => void): Promise<void> {
    // We only support persisting dictionary object logs.
    if (isDictionary(info)) {
      try {
        const logId = await this.getLogId();
        const key = this.datastore.key([this.kind, logId]);
        await this.datastore.save({
          key,
          data: {
            logId,
            botIdentifier: this.botIdentifier,
            transport: this.transport,
            info,
          },
          excludeFromIndexes: ["info"],
        });
      } catch (error) {
        return callback(new TransportError(this.transport, error, info));
      }
    }

    callback();
  }

  // Gets unique ascending log id.
  private async getLogId(): Promise<number> {
    const timestamp = Number(new Date());
    if (timestamp !== this.lastTimestamp) {
      this.idSuffixCounter = 0;
      this.lastTimestamp = timestamp;
    }
    // Its unlikely to have more than 1000 messages per millisecond, but anyways we handle this by recursing the call
    // in the next millisecond.
    if (this.idSuffixCounter >= 1000) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await this.getLogId();
    }
    const logId = timestamp * 1000 + this.idSuffixCounter;
    ++this.idSuffixCounter;
    return logId;
  }

  // Signal to pause processing messages from persistent storage.
  pauseProcessing() {
    this.canProcess = false;
  }

  // Logs queue element when processing persistent storage. Implementation is specific to derived class.
  abstract logQueueElement(info: Record<string, unknown>, logEntityKey: Key): Promise<void>;

  // Processes log queue from persistent storage.
  async processLogQueue(): Promise<void> {
    // Avoid concurrent log queue processing and lock it.
    if (this.isQueueBeingExecuted) return;
    this.isQueueBeingExecuted = true;

    // We will need access to info in catch block for more verbose error handling.
    let info: LogEntity["info"] | null;

    // Process queue unless received signal to pause before termination.
    while (this.canProcess) {
      info = null; // Reset info at the beginning of each iteration.

      try {
        const oldestLog = await this.getOldestLog();
        if (oldestLog === null) break; // We have processed all logs from persistent storage queue.

        // Destructure log info object and its entity key.
        const {
          logEntity: { info: logInfo },
          logEntityKey,
        } = oldestLog;
        info = logInfo;

        // Log the message in the derived transport implementation.
        await this.logQueueElement(info, logEntityKey);

        // We processed the log message, delete it from persistent storage.
        await this.datastore.delete(logEntityKey);
      } catch (error) {
        if (info === null) {
          // We cannot emit TransportError as we don't have access to original info object yet.
          this.emit("error", error);
        } else this.emit("error", new TransportError(this.transport, error, info));
        break;
      }

      // Wait before processing the next message if the implementation requires any rate limiting.
      await delay(this.rateLimit);
    }

    // Unlock the queue execution.
    this.isQueueBeingExecuted = false;
  }

  // Get the oldest queue element and its key or null if all of queue has been processed.
  async getOldestLog(): Promise<LogEntityAndKey | null> {
    const query = this.datastore
      .createQuery(this.kind)
      .filter(
        // Note: this requires setting up composite index at the Datastore:
        // - kind: PersistentLogQueue
        //   properties:
        //   - name: botIdentifier
        //   - name: transport
        //   - name: logId
        and([
          new PropertyFilter("botIdentifier", "=", this.botIdentifier),
          new PropertyFilter("transport", "=", this.transport),
        ])
      )
      .order("logId")
      .limit(1);
    const [entities] = await this.datastore.runQuery(query);

    if (entities.length === 0) return null; // There are no more log entries to process in the datastore.

    const logEntity = entities[0];
    const logEntityKey: Key = logEntity[this.datastore.KEY];
    if (!isLogEntity(logEntity)) throw new Error(`Invalid ${this.kind} entity, id=${logEntityKey.id}`);

    return { logEntity, logEntityKey };
  }
}
