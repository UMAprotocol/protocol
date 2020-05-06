// This transport enables winston logging to send messages to pager duty.

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
    // TODO: refactor this processing to better parse mrkdwn and complex data structure from winston.
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
          details: info.mrkdwn ? info.mrkdwn : info // If the message has markdown then add it. Else put the whole info object.
        }
      }
    });
    callback();
  }
};
