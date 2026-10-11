// This transport enables winston logging to send messages to pager duty v2 api.
import Transport from "winston-transport";

import { TransportError } from "./TransportError";
import type { Config } from "../shared/PagerDutyV2Transport";
import { sendPagerDutyEvent, validatePagerDutyEvent } from "../shared/PagerDutyV2Transport";

import { delay } from "../helpers/delay";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

export class PagerDutyV2Transport extends Transport {
  private readonly integrationKey: string;
  private readonly customServices: { [key: string]: string };
  public readonly logTransportErrors: boolean;
  private readonly pending = new Set<Promise<void>>();
  private readonly incidentQueues = new Map<string, Promise<void>>();

  public get isFlushed(): boolean {
    return this.pending.size === 0 && this.writableLength === 0;
  }

  // Include Winston's buffered writes as well as requests admitted to our incident queues.
  public async flush(): Promise<void> {
    while (!this.isFlushed) {
      await Promise.all([...this.pending]);
      if (!this.isFlushed) await delay(0.01);
    }
  }

  // Direct delivery deliberately bypasses the error-level filter and other logger transports.
  // Callers must handle rejection; logTransportErrors must not hide a failed recovery.
  public async resolveIncident(dedupKey: string, notificationPath?: string): Promise<void> {
    const info = { pagerDutyEventAction: "resolve" as const, pagerDutyDedupKey: dedupKey, notificationPath };
    validatePagerDutyEvent(info);
    await this.flush();
    try {
      await this.sendEvent(info);
    } catch (error) {
      throw new TransportError(
        "PagerDuty V2",
        error instanceof Error ? error : new Error("PagerDuty recovery request failed"),
        info
      );
    }
  }

  private async sendEvent(info: any): Promise<void> {
    validatePagerDutyEvent(info);
    const routingKey = this.customServices[info.notificationPath] ?? this.integrationKey;
    const queueKey =
      info.pagerDutyDedupKey === undefined ? undefined : JSON.stringify([routingKey, info.pagerDutyDedupKey]);
    const previous = queueKey === undefined ? undefined : this.incidentQueues.get(queueKey);
    const request = (previous ?? Promise.resolve()).then(() => sendPagerDutyEvent(routingKey, info));
    // A failed event must release its slot so a later recovery or trigger can still be sent.
    const settled = request.then(
      () => undefined,
      () => undefined
    );
    this.pending.add(settled);
    if (queueKey !== undefined) this.incidentQueues.set(queueKey, settled);
    try {
      await request;
    } finally {
      this.pending.delete(settled);
      if (queueKey !== undefined && this.incidentQueues.get(queueKey) === settled) this.incidentQueues.delete(queueKey);
    }
  }

  constructor(
    winstonOpts: TransportOptions,
    { integrationKey, customServices = {}, logTransportErrors = false }: Config
  ) {
    super(winstonOpts);
    this.integrationKey = integrationKey;
    this.customServices = customServices;
    this.logTransportErrors = logTransportErrors;
  }
  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: (error?: unknown) => void): Promise<void> {
    // Acknowledge queue admission immediately. Passing delivery failures to Winston's
    // callback can strand later buffered writes and prevent mandatory flush from finishing.
    const delivery = this.sendEvent(info);
    callback();
    try {
      await delivery;
    } catch (error) {
      // Avoid recursion when this transport also reports other transport failures.
      if (!this.logTransportErrors) this.emit("error", new TransportError("PagerDuty V2", error, info));
      else console.error("PagerDuty v2 error", error);
    }
  }
}
