// This transport enables winston logging to send messages to pager duty v2 api.
import Transport from "winston-transport";
import { event } from "@pagerduty/pdjs";
import * as ss from "superstruct";

type TransportOptions = ConstructorParameters<typeof Transport>[0];
export type Severity = "critical" | "error" | "warning" | "info";

const Config = ss.object({
  integrationKey: ss.string(),
  customServices: ss.optional(ss.record(ss.string(), ss.string())),
});
// Config object becomes a type
// {
//   integrationKey: string;
//   customServices?: Record<string,string>;
// }
export type Config = ss.Infer<typeof Config>;

// this turns an unknown ( like json parsed data) into a config, or throws an error
export function createConfig(config: unknown): Config {
  return ss.create(config, Config);
}

export class PagerDutyV2Transport extends Transport {
  private readonly integrationKey: string;
  private readonly customServices: { [key: string]: string };
  constructor(winstonOpts: TransportOptions, { integrationKey, customServices = {} }: Config) {
    super(winstonOpts);
    this.integrationKey = integrationKey;
    this.customServices = customServices;
  }
  // pd v2 severity only supports critical, error, warning or info.
  public static convertLevelToSeverity(level?: string): Severity {
    if (!level) return "error";
    if (level === "warn") return "warning";
    if (level === "info" || level === "critical") return level;
    return "error";
  }
  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: () => void): Promise<void> {
    try {
      // we route to different pd services using the integration key (routing_key), or multiple services with the custom services object
      const routing_key = this.customServices[info.notificationPath] ?? this.integrationKey;
      await event({
        data: {
          routing_key,
          event_action: "trigger",
          payload: {
            summary: `${info.level}: ${info.at} ⭢ ${info.message}`,
            severity: PagerDutyV2Transport.convertLevelToSeverity(this.level),
            source: info["bot-identifier"] ? info["bot-identifier"] : undefined,
            // we can put any structured data in here as long as it is can be repped as json
            custom_details: info,
          },
        },
      });
    } catch (error) {
      console.error("PagerDuty v2 error", error);
    }

    callback();
  }
}
