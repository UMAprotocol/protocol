// Bot wrapper providing methods for executing any kind of UMA bot. Currently supports Liquidator, monitor and disputer.

// TODO: refactor these to use the correct ts `import` syntax once we have appropriate typed interfaces.
const { createNewLogger } = require("@uma/financial-templates-lib");
const { getWeb3 } = require("@uma/common");

const Liquidator = require("@uma/liquidator");
const Disputer = require("@uma/disputer");
const Monitor = require("@uma/monitors");

import logCaptureTransport from "./LogCaptureTransport";

interface commonBotSettings {
  botType: string;
  syntheticSymbol: string;
  botIdentifier: string;
  botNetwork: string;
  slackConfig?: string;
  pagerDutyConfig?: string;
  financialContractAddress: string;
  errorRetries?: number;
  errorRetriesTimeout?: number;
}

export interface liquidatorConfig extends commonBotSettings {
  priceFeedConfig?: any;
  liquidatorConfig?: any;
  liquidatorOverridePrice?: string;
  startingBlock?: number;
  endingBlock?: number;
}

export interface disputerConfig extends commonBotSettings {
  priceFeedConfig?: any;
  disputerConfigConfig?: any;
  disputerOverridePrice?: string;
}

export interface monitorConfig extends commonBotSettings {
  optimisticOracleAddress: string;
  monitorConfigConfig?: any;
  tokenPriceFeedConfig?: any;
  medianizerPriceFeedConfig?: any;
  denominatorPriceFeedConfig?: any;
  startingBlock?: number;
  endingBlock?: number;
}

async function _executeBot(
  botEntryPoint: typeof Liquidator | typeof Disputer | typeof Monitor,
  config: liquidatorConfig | disputerConfig | monitorConfig
) {
  const logs: any = [];
  const financialContractAddress = config.financialContractAddress;
  const botIdentifier = config.botIdentifier;
  try {
    // Build a custom logger using all default transports(except the console transport) and the logCaptureTransport.
    // As this piggy backs off the default transports, existing log capture paths (such as Pagerduty and slack) will
    // continue to work within each executed strategy.
    const logger = createNewLogger(
      [new logCaptureTransport({ level: "debug" }, logs)],
      { slackConfig: config.slackConfig, pagerdutyConfig: config.pagerDutyConfig, createConsoleTransport: false },
      botIdentifier
    );

    // Execute the bot process with the provided log. Create a custom web3 instance for each bot on the `botNetwork`.
    await botEntryPoint.run({ logger, web3: getWeb3(config.botNetwork), ...config });

    return { financialContractAddress, botIdentifier, logs };
  } catch (error) {
    return { financialContractAddress, botIdentifier, logs, error: (error as Error).toString() };
  }
}

// Execute a bot of type `liquidator`, `disputer` or `monitor.
export async function runBot(config: liquidatorConfig | disputerConfig | monitorConfig) {
  if (config.botType == "liquidator") return await _executeBot(Liquidator, config);
  if (config.botType == "disputer") return await _executeBot(Disputer, config);
  if (config.botType == "monitor") return await _executeBot(Monitor, config);
  throw new Error("Bot type not supported");
}
