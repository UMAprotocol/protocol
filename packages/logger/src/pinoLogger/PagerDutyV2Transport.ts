// This transport enables pino logging to send messages to PagerDuty v2 API.
// Pino transports run in worker threads for performance, so they can import dependencies.
import build from "pino-abstract-transport";
import type { Transform } from "stream";
import { event } from "@pagerduty/pdjs";
import type { Config, Action } from "../pagerduty/SharedConfig";
import { createConfig, convertLevelToSeverity } from "../pagerduty/SharedConfig";
import { removeAnchorTextFromLinks } from "../logger/Formatters";

export default async function (opts: Config): Promise<Transform & build.OnUnknown> {
  const config = createConfig(opts);

  return build(
    async function (source) {
      for await (const obj of source) {
        try {
          // Get routing key from custom services or use default integration key
          const routing_key = config.customServices?.[obj.notificationPath] ?? config.integrationKey;

          // Extract message and format
          const message = obj.msg || obj.message || "No message";
          const at = obj.at || obj.name || "unknown";
          const level = obj.level;

          // PagerDuty does not support anchor text in links, so we remove it from markdown if it exists.
          if (typeof obj.mrkdwn === "string") obj.mrkdwn = removeAnchorTextFromLinks(obj.mrkdwn);

          // Send event to PagerDuty
          await event({
            data: {
              routing_key,
              event_action: "trigger" as Action,
              payload: {
                summary: `${level}: ${at} ⭢ ${message}`,
                severity: convertLevelToSeverity(level),
                source: obj["bot-identifier"] || obj.botIdentifier,
                // Include all structured log data
                custom_details: obj,
              },
            },
          });
        } catch (error) {
          // Log transport errors to console to avoid recursion
          if (config.logTransportErrors) {
            console.error("PagerDuty v2 transport error:", error);
          }
        }
      }
    },
    {
      // Parse each line as JSON
      parse: "lines",
    }
  );
}
