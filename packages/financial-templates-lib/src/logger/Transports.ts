// This module generates transport objects for the winston logger to push messages to. Primarily this module separates
// the logic for reading in state environment variables from the logger itself. All Winston transport objects and their
// associated formatting are created within this module.

// Transport objects
import { createConsoleTransport } from "./ConsoleTransport";
import { createJsonTransport } from "./JsonTransport";
import { createSlackTransport } from "./SlackTransport";
import { PagerDutyTransport } from "./PagerDutyTransport";
import { PagerDutyV2Transport } from "./PagerDutyV2Transport";
import { DiscordTransport } from "./DiscordTransport";
import type Transport from "winston-transport";
import dotenv from "dotenv";
import minimist from "minimist";

dotenv.config();
const argv = minimist(process.argv.slice(), {});

type SlackConfig = Parameters<typeof createSlackTransport>[0];
type DiscordConfig = ConstructorParameters<typeof DiscordTransport>[1];
type PagerDutyConfig = ConstructorParameters<typeof PagerDutyTransport>[1];
type PagerDutyV2Config = ConstructorParameters<typeof PagerDutyV2Transport>[1];

interface TransportsConfig {
  environment?: string;
  createConsoleTransport?: boolean;
  slackConfig?: SlackConfig;
  discordConfig?: DiscordConfig;
  pdApiToken?: string;
  pagerDutyConfig?: PagerDutyConfig;
  pagerDutyV2Config?: PagerDutyV2Config;
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

  // If there is "test" in the environment then skip the slack, pagerduty and discord.
  if (argv._.indexOf("test") == -1) {
    // If there is a slack web hook, add to the transports array to enable slack messages.
    const slackConfig: SlackConfig = transportsConfig.slackConfig ?? JSON.parse(process.env.SLACK_CONFIG || "null");
    if (slackConfig) {
      transports.push(createSlackTransport(slackConfig));
    }

    // If there is a discord config, create a new transport.
    if (transportsConfig.discordConfig || process.env.DISCORD_CONFIG) {
      transports.push(
        new DiscordTransport(
          { level: "info" },
          transportsConfig.discordConfig ?? JSON.parse(process.env.DISCORD_CONFIG || "null")
        )
      );
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
    // typescript is not properly typing this as a parsed json string should be "unknown",
    // but we are relying on this quirk throughout this file. The PD v2 transport class will check
    // that the config is valid or throw an error to prevent errors while running.
    const pagerDutyV2Config =
      transportsConfig.pagerDutyV2Config ?? JSON.parse(process.env.PAGER_DUTY_V2_CONFIG || "null");
    // If there is a Pagerduty V2 API key then add the pagerduty winston transport.
    if (pagerDutyV2Config) {
      try {
        transports.push(new PagerDutyV2Transport({ level: "warn" }, pagerDutyV2Config));
      } catch (err) {
        if (err instanceof Error) {
          console.warn("Pagerduty V2 Config not added due to error: ", err.message);
        }
      }
    }
  }
  return transports;
}
