// This module generates transport objects for the winston logger to push messages to. Primarily this module separates
// the logic for reading in state environment variables from the logger itself. All Winston transport objects and their
// associated formatting are created within this module.

// Transport objects
const ConsoleTransport = require("./ConsoleTransport");
const JsonTransport = require("./JsonTransport");
const SlackTransport = require("./SlackTransport");
const PagerDutyTransport = require("./PagerDutyTransport");

require("dotenv").config();
const argv = require("minimist")(process.argv.slice(), {});

function createTransports(transportsConfig = {}) {
  // Transports array to store all winston transports.
  let transports = [];

  // If the logger is running in serverless mode then add the GCP winston transport and console transport.
  if ((transportsConfig.environment ?? process.env.ENVIRONMENT) == "serverless") {
    const { LoggingWinston } = require("@google-cloud/logging-winston");
    if (!require("@google-cloud/trace-agent").get().enabled) require("@google-cloud/trace-agent").start();
    transports.push(new LoggingWinston());
    transports.push(JsonTransport.createJsonTransport());
  }

  // If the logger is running in production mode then add the GCE winston transport. Else, add a console transport.
  else if ((transportsConfig.environment ?? process.env.ENVIRONMENT) == "production") {
    const { LoggingWinston } = require("@google-cloud/logging-winston");
    if (!require("@google-cloud/trace-agent").get().enabled) require("@google-cloud/trace-agent").start();
    transports.push(new LoggingWinston());
  } else if (transportsConfig.createConsoleTransport != undefined ? transportsConfig.createConsoleTransport : true) {
    // Add a console transport to log to the console.
    transports.push(ConsoleTransport.createConsoleTransport());
  }

  // If there is "test" in the environment then skip the slack or pagerduty.
  if (argv._.indexOf("test") == -1) {
    // If there is a slack web hook, add to the transports array to enable slack messages.
    const slackConfig = transportsConfig.slackConfig ?? JSON.parse(process.env.SLACK_CONFIG || null);
    if (slackConfig) {
      transports.push(SlackTransport.createSlackTransport(slackConfig));
    }

    // If there is a Pagerduty API key then add the pagerduty winston transport.
    if (transportsConfig.pdApiToken || process.env.PAGER_DUTY_CONFIG) {
      transports.push(
        new PagerDutyTransport(
          { level: "warn" },
          transportsConfig.pagerDutyConfig ?? JSON.parse(process.env.PAGER_DUTY_CONFIG || null)
        )
      );
    }
  }
  return transports;
}

module.exports = { createTransports };
