// This transport enables winston logging to send messages to pager duty v2 api.
import Transport from "winston-transport";
import { event } from "@pagerduty/pdjs";

type TransportOptions = ConstructorParameters<typeof Transport>[0];
export type Severity = "critical" | "error" | "warning" | "info";

interface Config {
  integrationKey: string;
  customServices?: { [key: string]: string };
}

export class PagerDutyTransportV2 extends Transport {
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
      await event({
        data: {
          routing_key: this.integrationKey,
          event_action: "trigger",
          payload: {
            summary: `${info.level}: ${info.at} ⭢ ${info.message}`,
            severity: PagerDutyTransportV2.convertLevelToSeverity(this.level),
            source: info["bot-identifier"] ? info["bot-identifier"] : undefined,
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
