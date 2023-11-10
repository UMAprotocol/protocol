// This transport enables winston logging to send messages to pager duty. All pager duty logs are either `low` or `high`
// urgency. If set to `low` the incident has a less aggressive escalation policy. In this `low` setting if the
// notification is not acknowledged by the person on call within 30 mins a second person is contacted until the warning
// is acknowledged. If set to `high` the incident is aggressively escalated. If no acknowledgement within 5 minutes a
//  second person is contacted until the message is acknowledged.
import Transport from "winston-transport";
import PagerDutyClient from "node-pagerduty";

import { removeAnchorTextFromLinks } from "./Formatters";
import { TransportError } from "./TransportError";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

export class PagerDutyTransport extends Transport {
  private readonly pd: PagerDutyClient;
  private readonly fromEmail: string;
  private readonly defaultServiceId: string;
  private readonly customServices: { [key: string]: string };
  public readonly logTransportErrors: boolean;
  constructor(
    winstonOpts: TransportOptions,
    {
      pdApiToken,
      fromEmail,
      defaultServiceId,
      customServices = {},
      logTransportErrors = false,
    }: {
      pdApiToken: string;
      fromEmail: string;
      defaultServiceId: string;
      customServices?: { [key: string]: string };
      logTransportErrors?: boolean;
    }
  ) {
    super(winstonOpts);

    this.pd = new PagerDutyClient(pdApiToken);

    this.fromEmail = fromEmail;
    this.defaultServiceId = defaultServiceId;
    this.customServices = customServices;
    this.logTransportErrors = logTransportErrors;
  }

  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: (error?: unknown) => void): Promise<void> {
    try {
      // If the message has markdown then add it (with removed anchor text from links that is not supported by PD) and
      // the bot-identifier field. Else put the whole info object as a string.
      const logMessage =
        typeof info.mrkdwn === "string"
          ? removeAnchorTextFromLinks(info.mrkdwn) + `\n${info["bot-identifier"]}`
          : JSON.stringify(info);

      // If the log contains a notification path then use a custom PagerDuty service. This lets the transport route to
      // different pagerduty escalation paths depending on the context of the log.
      const serviceId = this.customServices[info.notificationPath] ?? this.defaultServiceId;

      await this.pd.incidents.createIncident(this.fromEmail, {
        incident: {
          type: "incident",
          title: `${info.level}: ${info.at} ⭢ ${info.message}`,
          service: { id: serviceId, type: "service_reference" },
          urgency: info.level == "warn" ? "low" : "high", // If level is warn then urgency is low. If level is error then urgency is high.
          body: { type: "incident_body", details: logMessage },
        },
      });
    } catch (error) {
      // We don't want to emit error if this same transport is used to log transport errors to avoid recursion.
      if (!this.logTransportErrors) return callback(new TransportError("PagerDuty", error, info));
      console.error("PagerDuty error", error);
    }

    callback();
  }
}
