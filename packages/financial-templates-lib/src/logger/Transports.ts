// This module generates transport objects for the winston logger to push messages to. Primarily this module separates
// the logic for reading in state environment variables from the logger itself. All Winston transport objects and their
// associated formatting are created within this module.

// Transport objects
import { createConsoleTransport } from "./ConsoleTransport";
import { createJsonTransport } from "./JsonTransport";
import { createSlackTransport } from "./SlackTransport";
import { PagerDutyTransport } from "./PagerDutyTransport";
import type Transport from "winston-transport";
import dotenv from "dotenv";
import minimist from "minimist";

dotenv.config();
const argv = minimist(process.argv.slice(), {});

type SlackConfig = Parameters<typeof createSlackTransport>[0];
type PagerDutyConfig = ConstructorParameters<typeof PagerDutyTransport>[1];

interface TransportsConfig {
  environment?: string;
  createConsoleTransport?: boolean;
  slackConfig?: SlackConfig;
  pdApiToken?: string;
  pagerDutyConfig?: PagerDutyConfig;
}

export function createTransports(transportsConfig: TransportsConfig = {}): Transport[] {
  // Transports array to store all winston transports.
  const transports: Transport[] = [];

  // If the logger is running in serverless mode then add the GCP winston transport and console transport.
  if ((transportsConfig.environment ?? process.env.ENVIRONMENT) == "serverless") {
    const { LoggingWinston } = require("@google-cloud/logging-winston");
    transports.push(new LoggingWinston());
    if (!require("@google-cloud/trace-agent").get().enabled) require("@google-cloud/trace-agent").start();
    transports.push(createJsonTransport());
  }

  // If the logger is running in production mode then add the GCE winston transport. Else, add a console transport.
  else if ((transportsConfig.environment ?? process.env.ENVIRONMENT) == "production") {
    const { LoggingWinston } = require("@google-cloud/logging-winston");
    transports.push(new LoggingWinston());
    if (!require("@google-cloud/trace-agent").get().enabled) require("@google-cloud/trace-agent").start();
  } else if (transportsConfig.createConsoleTransport != undefined ? transportsConfig.createConsoleTransport : true) {
    // Add a console transport to log to the console.
    transports.push(createConsoleTransport());
  }

  // If there is "test" in the environment then skip the slack and pagerduty.
  if (argv._.indexOf("test") == -1) {
    // If there is a slack web hook, add to the transports array to enable slack messages.
    const slackConfig: SlackConfig = transportsConfig.slackConfig ?? JSON.parse(process.env.SLACK_CONFIG || "null");
    if (slackConfig) {
      transports.push(createSlackTransport(slackConfig));
    }

    // If there is a Pagerduty API key then add the pagerduty winston transport.
    if (transportsConfig.pdApiToken || process.env.PAGER_DUTY_CONFIG) {
      transports.push(
        new PagerDutyTransport(
          { level: "warn" },
          transportsConfig.pagerDutyConfig ?? JSON.parse(process.env.PAGER_DUTY_CONFIG || "null")
        )
      );
    }
  }
  return transports;
}
