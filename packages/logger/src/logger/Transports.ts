// This module generates transport objects for the winston logger to push messages to. Primarily this module separates
// the logic for reading in state environment variables from the logger itself. All Winston transport objects and their
// associated formatting are created within this module.

// Transport objects
import { createConsoleTransport } from "./ConsoleTransport";
import { createJsonTransport } from "./JsonTransport";
import { createSlackTransport } from "./SlackTransport";
import { PagerDutyTransport } from "./PagerDutyTransport";
import {
  Config as DiscordTicketConfig,
  createConfig as discordTicketCreateConfig,
  DiscordTicketTransport,
} from "./DiscordTicketTransport";
import {
  PagerDutyV2Transport,
  Config as PagerDutyV2Config,
  createConfig as pagerDutyV2CreateConfig,
} from "./PagerDutyV2Transport";
import { DiscordTransport } from "./DiscordTransport";
import type Transport from "winston-transport";
import dotenv from "dotenv";
import minimist from "minimist";

dotenv.config();
const argv = minimist(process.argv.slice(), {});

type SlackConfig = Parameters<typeof createSlackTransport>[0];
type DiscordConfig = ConstructorParameters<typeof DiscordTransport>[1];
type PagerDutyConfig = ConstructorParameters<typeof PagerDutyTransport>[1];

interface TransportsConfig {
  environment?: string;
  createConsoleTransport?: boolean;
  slackConfig?: SlackConfig;
  discordConfig?: DiscordConfig;
  discordTicketConfig?: DiscordTicketConfig;
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

    // If there is a discord ticket config, create a new transport.
    if (transportsConfig.discordTicketConfig || process.env.DISCORD_TICKET_CONFIG) {
      const discordTicketConfig =
        transportsConfig.discordTicketConfig ?? JSON.parse(process.env.DISCORD_TICKET_CONFIG || "null");
      transports.push(new DiscordTicketTransport({ level: "info" }, discordTicketCreateConfig(discordTicketConfig)));
    }

    // If there is a Pagerduty API key then add the pagerduty winston transport.
    if (transportsConfig.pdApiToken || process.env.PAGER_DUTY_CONFIG) {
      transports.push(
        new PagerDutyTransport(
          { level: "error" },
          transportsConfig.pagerDutyConfig ?? JSON.parse(process.env.PAGER_DUTY_CONFIG || "null")
        )
      );
    }

    if (transportsConfig.pagerDutyV2Config || process.env.PAGER_DUTY_V2_CONFIG) {
      // to disable pdv2, pass in a "disabled=true" in configs or env.
      const { disabled = false, ...pagerDutyV2Config } =
        transportsConfig.pagerDutyV2Config ?? JSON.parse(process.env.PAGER_DUTY_V2_CONFIG || "null");
      // this will throw an error if an invalid configuration is present
      if (!disabled) {
        transports.push(new PagerDutyV2Transport({ level: "error" }, pagerDutyV2CreateConfig(pagerDutyV2Config)));
      }
    }
  }
  return transports;
}
