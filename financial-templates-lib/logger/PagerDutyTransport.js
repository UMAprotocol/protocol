// This transport enables winston logging to send messages to pager duty. All pager duty logs are either `low` or `high`
// urgency. If set to `low` the incident has a less aggressive escalation policy. In this `low` setting if the
// notification is not acknowledged by the person on call within 30 mins a second person is contacted until the warning
// is acknowledged. If set to `high` the incident is aggressively escalated. If no acknowledgement within 5 minutes a
//  second person is contacted until the message is acknowledged.

const Transport = require("winston-transport");
const pdClient = require("node-pagerduty");

module.exports = class PagerDutyTransport extends Transport {
  constructor(winstonOpts, pagerDutyOptions) {
    super(winstonOpts);
    this.serviceId = pagerDutyOptions.pdServiceId;
    this.fromEmail = pagerDutyOptions.fromEmail;
    this.pd = new pdClient(pagerDutyOptions.pdApiToken);
  }

  async log(info, callback) {
    try {
      // If the message has markdown then add it and the bot-identifer field. Else put the whole info object as a string
      const logMessage = info.mrkdwn ? info.mrkdwn + `\n${info["bot-identifier"]}` : JSON.stringify(info);

      await this.pd.incidents.createIncident(this.fromEmail, {
        incident: {
          type: "incident",
          title: `${info.level}: ${info.at} ⭢ ${info.message}`,
          service: {
            id: this.serviceId,
            type: "service_reference"
          },
          urgency: info.level == "warn" ? "low" : "high", // If level is warn then urgency is low. If level is error then urgency is high.
          body: {
            type: "incident_body",
            details: logMessage
          }
        }
      });
    } catch (error) {
      console.error("PagerDuty error", error);
    }

    callback();
  }
};
