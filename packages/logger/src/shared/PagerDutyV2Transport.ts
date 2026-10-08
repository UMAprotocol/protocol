// Shared PagerDuty V2 configuration and utilities
// Used by both Winston and Pino PagerDuty transports
import * as ss from "superstruct";
import { event } from "@pagerduty/pdjs";
import { levels } from "pino";
import { removeAnchorTextFromLinks } from "../logger/Formatters";

export type Severity = "critical" | "error" | "warning" | "info";
export type Action = "trigger" | "acknowledge" | "resolve";

const Config = ss.object({
  integrationKey: ss.string(),
  customServices: ss.optional(ss.record(ss.string(), ss.string())),
  logTransportErrors: ss.optional(ss.boolean()),
});

export type Config = ss.Infer<typeof Config>;

// This turns an unknown (like json parsed data) into a config, or throws an error
export function createConfig(config: unknown): Config {
  return ss.create(config, Config);
}

// PD v2 severity only supports critical, error, warning or info.
// Handles both Winston string levels and Pino numeric levels.
export function convertLevelToSeverity(level?: string | number): Severity {
  if (!level) return "info";

  // Convert numeric Pino levels to string names using Pino's built-in mapping
  const levelStr = typeof level === "number" ? levels.labels[level] : String(level).toLowerCase();

  // Map level names to PagerDuty severity values
  if (levelStr === "fatal") return "critical";
  if (levelStr === "error") return "error";
  if (levelStr === "warn") return "warning";
  if (levelStr === "info") return "info";
  if (levelStr === "critical") return "critical";

  // Unknown/unmapped levels (debug, trace, etc.) default to lowest severity
  return "info";
}

export interface PagerDutyEventFields {
  pagerDutyDedupKey?: string;
  pagerDutyEventAction?: "trigger" | "resolve";
}

// Validate opt-in lifecycle fields before either queueing or making a network request.
export function validatePagerDutyEvent(logObj: PagerDutyEventFields): void {
  const action = logObj.pagerDutyEventAction;
  if (action !== undefined && action !== "trigger" && action !== "resolve") {
    throw new Error("pagerDutyEventAction must be trigger or resolve");
  }
  const key = logObj.pagerDutyDedupKey;
  if (
    (key !== undefined &&
      (typeof key !== "string" || key.trim().length === 0 || Buffer.byteLength(key, "utf8") > 255)) ||
    (action === "resolve" && key === undefined)
  ) {
    throw new Error(
      "pagerDutyDedupKey must be a nonempty string of at most 255 UTF-8 bytes and is required for resolve"
    );
  }
}

// Send event to PagerDuty V2 API. Unkeyed logs retain their ordinary trigger behavior.
export async function sendPagerDutyEvent(routing_key: string, logObj: any): Promise<void> {
  validatePagerDutyEvent(logObj);
  const event_action = logObj.pagerDutyEventAction ?? "trigger";
  const dedupKey = logObj.pagerDutyDedupKey;
  type EventData = Parameters<typeof event>[0]["data"];
  const data: Omit<EventData, "payload"> & { payload?: EventData["payload"] } = {
    routing_key,
    event_action,
    ...(dedupKey !== undefined ? { dedup_key: dedupKey } : {}),
  };

  // Resolves require no alert payload; in particular they must not create another incident.
  if (event_action === "trigger") {
    if (typeof logObj.mrkdwn === "string") {
      logObj.mrkdwn = removeAnchorTextFromLinks(logObj.mrkdwn);
    }
    const levelStr = typeof logObj.level === "number" ? levels.labels[logObj.level] : logObj.level;
    data.payload = {
      summary: `${levelStr}: ${logObj.at} ⭢ ${logObj.message}`,
      severity: convertLevelToSeverity(logObj.level),
      source: logObj["bot-identifier"] ? logObj["bot-identifier"] : undefined,
      custom_details: logObj,
    };
  }

  // pdjs types require a trigger payload even for resolve, although Events API v2 does not.
  // Its retry sleeps ignore AbortSignal, so bound the entire operation as well as aborting fetch.
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("PagerDuty event timed out after 30 seconds"));
      controller.abort();
    }, 30000);
  });
  try {
    const response = await Promise.race([
      event({ data: data as EventData, signal: controller.signal, requestTimeout: 0 }),
      deadline,
    ]);
    // pdjs resolves HTTP errors, including exhausted rate-limit retries, instead of rejecting.
    if (!response.ok) throw new Error(`PagerDuty event rejected with HTTP ${response.status}`);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
