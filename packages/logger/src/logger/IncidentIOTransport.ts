import Transport from "winston-transport";
import axios from "axios";
import { createHash, randomUUID } from "crypto";
import * as ss from "superstruct";
import { TransportError } from "./TransportError";
import { delay } from "../helpers/delay";

const Destination = ss.object({
  url: ss.pattern(ss.string(), /^https:\/\/api\.incident\.io\/v2\/alert_events\/http\/[A-Za-z0-9_-]+$/),
  token: ss.size(ss.string(), 1, Infinity),
  urgency: ss.optional(ss.enums(["high", "low", "severity_based"])),
  supportHours: ss.optional(
    ss.object({
      timeZone: ss.string(),
      startHour: ss.min(ss.max(ss.integer(), 23), 0),
      endHour: ss.min(ss.max(ss.integer(), 24), 1),
    })
  ),
});
const ConfigSchema = ss.object({
  destination: Destination,
  customServices: ss.optional(ss.record(ss.string(), Destination)),
});
export type Config = ss.Infer<typeof ConfigSchema>;
export function createConfig(value: unknown): Config {
  const config = ss.create(value, ConfigSchema);
  for (const destination of [config.destination, ...Object.values(config.customServices ?? {})]) {
    if (destination.supportHours) {
      const { timeZone, startHour, endHour } = destination.supportHours;
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
      if (startHour >= endHour) throw new Error("supportHours requires startHour < endHour");
    }
  }
  return config;
}

export function pagingUrgency(destination: Config["destination"], level: string, now = new Date()): string {
  if (destination.supportHours) {
    const { timeZone, startHour, endHour } = destination.supportHours;
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
    return hour >= startHour && hour < endHour ? "high" : "low";
  }
  const urgency = destination.urgency ?? "high";
  return urgency === "severity_based" ? (["warn", "warning", "info"].includes(level) ? "low" : "high") : urgency;
}

const MAX_ATTEMPTS = 3;

// incident.io sends Retry-After in seconds with a 429. Honour it, capped at the logger's default 30s flush timeout:
// a longer wait cannot deliver before a shutting-down bot exits. Without it, back off exponentially.
export function retryDelay(retryAfter: unknown, attempt: number): number {
  if (typeof retryAfter === "string" && /^\d+$/.test(retryAfter.trim())) return Math.min(Number(retryAfter), 30);
  return 0.25 * 2 ** (attempt - 1);
}

// An independent Winston transport: PagerDuty keeps its existing destination,
// delivery and failure handling. No PagerDuty webhook or API result is used.
export class IncidentIOTransport extends Transport {
  private pending = 0;
  get isFlushed(): boolean {
    return this.pending === 0;
  }
  constructor(options: ConstructorParameters<typeof Transport>[0], private readonly config: Config) {
    super(options);
  }

  async log(info: any, callback: (error?: unknown) => void): Promise<void> {
    this.pending++;
    try {
      const destination = this.config.customServices?.[info.notificationPath] ?? this.config.destination;

      const title = `${info.level}: ${info.at} ⭢ ${info.message}`;
      // Match the existing trigger-only logger semantics: each log occurrence
      // is separate unless its producer supplies a stable key. Retries of this
      // send always reuse the same key. Never infer recovery from quiet logs.
      const rawKey = typeof info.incidentDeduplicationKey === "string" ? info.incidentDeduplicationKey : randomUUID();
      const deduplicationKey = createHash("sha256")
        .update(JSON.stringify([info["bot-identifier"] ?? "", info.notificationPath ?? "", rawKey]))
        .digest("hex");
      const payload = {
        title: title.slice(0, 1024),
        description: typeof info.mrkdwn === "string" ? info.mrkdwn : title,
        status: "firing",
        deduplication_key: deduplicationKey,
        metadata: {
          ...info,
          paging_urgency: pagingUrgency(destination, info.level),
        },
      };
      await this.deliver(destination, payload);
      callback();
    } catch (error) {
      callback(new TransportError("incident.io", error, info));
    } finally {
      this.pending--;
    }
  }

  private async deliver(destination: Config["destination"], payload: { deduplication_key: string }): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      // Every HTTP status resolves, so only network errors and timeouts reject. Axios errors contain credentials
      // and payloads, so drop them unread rather than expose them to the logger's error handlers.
      const response = await axios
        .post(destination.url, payload, {
          headers: { Authorization: `Bearer ${destination.token}` },
          timeout: 5000,
          maxRedirects: 0,
          validateStatus: () => true,
        })
        .catch(() => undefined);
      const status = response?.status;
      const ok = status !== undefined && status >= 200 && status < 300;
      if (
        ok &&
        ["accepted", "success"].includes(response?.data?.status) &&
        response?.data?.deduplication_key === payload.deduplication_key
      ) {
        return;
      }
      // Retries reuse the event key, so an unconfirmed 2xx is safe to resend.
      const retryable = status === undefined || ok || status === 429 || status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        const reason = ok ? "event key not confirmed" : status ? `HTTP ${status}` : "no response";
        throw new Error(`incident.io delivery failed (${reason})`);
      }
      await delay(retryDelay(response?.headers?.["retry-after"], attempt));
    }
  }
}
