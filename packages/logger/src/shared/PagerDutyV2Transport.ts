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
  if (typeof level === "number") {
    // Pino uses numeric levels: trace=10, debug=20, info=30, warn=40, error=50, fatal=60
    if (level >= 60) return "critical";
    if (level >= 50) return "error";
    if (level >= 40) return "warning";
    return "info";
  }
  if (!level) return "error";
  const levelStr = String(level).toLowerCase();
  if (levelStr === "warn") return "warning";
  if (levelStr === "fatal") return "critical";
  if (levelStr === "info" || levelStr === "critical") return levelStr as Severity;
  return "error";
}

// Send event to PagerDuty V2 API
// Accepts the whole log object and routing key, extracts necessary fields
export async function sendPagerDutyEvent(routing_key: string, logObj: any): Promise<void> {
  // PagerDuty does not support anchor text in links, so we remove it from markdown if it exists.
  if (typeof logObj.mrkdwn === "string") {
    logObj.mrkdwn = removeAnchorTextFromLinks(logObj.mrkdwn);
  }

  // Convert numeric Pino levels to strings for summary (Winston already uses strings)
  const levelStr = typeof logObj.level === "number" ? levels.labels[logObj.level] : logObj.level;

  const payload: any = {
    summary: `${levelStr}: ${logObj.at} ⭢ ${logObj.message}`,
    severity: convertLevelToSeverity(logObj.level),
    source: logObj["bot-identifier"] ? logObj["bot-identifier"] : undefined,
    custom_details: logObj,
  };

  await event({
    data: {
      routing_key,
      event_action: "trigger" as Action,
      payload,
    },
  });
}
