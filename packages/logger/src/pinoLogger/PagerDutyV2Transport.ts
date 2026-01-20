// This transport enables pino logging to send messages to PagerDuty v2 API.
// Pino transports run in worker threads for performance, so they can import dependencies.
import build from "pino-abstract-transport";
import type { Transform } from "stream";
import type { Config } from "../pagerduty/SharedConfig";
import { createConfig, sendPagerDutyEvent } from "../pagerduty/SharedConfig";

export default async function (opts: Config): Promise<Transform & build.OnUnknown> {
  const config = createConfig(opts);

  return build(
    async function (source) {
      for await (const obj of source) {
        try {
          // Get routing key from custom services or use default integration key
          const routing_key = config.customServices?.[obj.notificationPath] ?? config.integrationKey;
          await sendPagerDutyEvent(routing_key, obj);
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
