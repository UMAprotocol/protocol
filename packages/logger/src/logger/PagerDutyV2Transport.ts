// This transport enables winston logging to send messages to pager duty v2 api.
import Transport from "winston-transport";
import { event } from "@pagerduty/pdjs";

import { removeAnchorTextFromLinks } from "./Formatters";
import { TransportError } from "./TransportError";
import {
  type Severity,
  type Action,
  type Config,
  createConfig,
  convertLevelToSeverity,
} from "../pagerduty/SharedConfig";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

// Re-export types for backwards compatibility
export type { Severity, Action, Config };
export { createConfig };

export class PagerDutyV2Transport extends Transport {
  private readonly integrationKey: string;
  private readonly customServices: { [key: string]: string };
  public readonly logTransportErrors: boolean;
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
    try {
      // we route to different pd services using the integration key (routing_key), or multiple services with the custom services object
      const routing_key = this.customServices[info.notificationPath] ?? this.integrationKey;
      // PagerDuty does not support anchor text in links, so we remove it from markdown if it exists.
      if (typeof info.mrkdwn === "string") info.mrkdwn = removeAnchorTextFromLinks(info.mrkdwn);
      await event({
        data: {
          routing_key,
          event_action: "trigger" as Action,
          payload: {
            summary: `${info.level}: ${info.at} ⭢ ${info.message}`,
            severity: convertLevelToSeverity(info.level),
            source: info["bot-identifier"] ? info["bot-identifier"] : undefined,
            // we can put any structured data in here as long as it is can be repped as json
            custom_details: info,
          },
        },
      });
    } catch (error) {
      // We don't want to emit error if this same transport is used to log transport errors to avoid recursion.
      if (!this.logTransportErrors) return callback(new TransportError("PagerDuty V2", error, info));
      console.error("PagerDuty v2 error", error);
    }

    callback();
  }
}
