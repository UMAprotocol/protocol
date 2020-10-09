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

// Transports array to store all winston transports.
let transports = [];

// If the logger is running in serverless mode then add the GCP winston transport and console transport.
if (process.env.ENVIRONMENT == "serverless") {
  const { LoggingWinston } = require("@google-cloud/logging-winston");
  require("@google-cloud/trace-agent").start();
  transports.push(new LoggingWinston());
  transports.push(JsonTransport.createJsonTransport());
}

// If the logger is running in production mode then add the GCE winston transport. Else, add a console transport.
else if (process.env.ENVIRONMENT == "production") {
  const { LoggingWinston } = require("@google-cloud/logging-winston");
  require("@google-cloud/trace-agent").start();
  transports.push(new LoggingWinston());
} else {
  // Add a console transport to log to the console.
  transports.push(ConsoleTransport.createConsoleTransport());
}

// If there is "test" in the environment then skip the slack or pagerduty.
if (argv._.indexOf("test") == -1) {
  // If there is a slack web hook, add to the transports array to enable slack messages.
  if (process.env.SLACK_WEBHOOK) {
    transports.push(SlackTransport.createSlackTransport(process.env.SLACK_WEBHOOK));
  }

  // If there is a Pagerduty API key then add the pagerduty winston transport.
  if (process.env.PAGERDUTY_API_KEY) {
    transports.push(
      new PagerDutyTransport(
        { level: "warn" },
        {
          pdApiToken: process.env.PAGERDUTY_API_KEY,
          pdServiceId: process.env.PAGERDUTY_SERVICE_ID,
          fromEmail: process.env.PAGERDUTY_FROM_EMAIL
        }
      )
    );
  }
}

module.exports = { transports };
