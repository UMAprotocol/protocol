const { createNewLogger } = require("@uma/financial-templates-lib");
const { getWeb3 } = require("@uma/common");

const Liquidator = require("@uma/liquidator");
const Disputer = require("@uma/disputer");
const Monitor = require("@uma/monitors");

import logCaptureTransport from "./LogCaptureTransport";

interface commonBotSettings {
  botType: string;
  syntheticSymbol: string;
  botNetwork: string;
  slackWebHook?: string;
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

async function executeBot(botEntryPoint: any, config: liquidatorConfig | disputerConfig | monitorConfig) {
  const logs: any = [];
  const botIdentifier = `${config.syntheticSymbol} ${config.botType}`;
  try {
    const logger = createNewLogger(
      [new logCaptureTransport({ level: "debug" }, logs)],
      { slackWebHook: config.slackWebHook, createConsoleTransport: false },
      botIdentifier
    );

    await botEntryPoint.run({ logger, web3: getWeb3(config.botNetwork), ...config });

    return { financialContractAddress: config.financialContractAddress, botIdentifier: botIdentifier, logs };
  } catch (error) {
    return { financialContractAddress: config.financialContractAddress, botIdentifier, logs, error: error.toString() };
  }
}

export async function runBot(config: liquidatorConfig | disputerConfig | monitorConfig) {
  if (config.botType == "liquidator") return await executeBot(Liquidator, config);
  if (config.botType == "disputer") return await executeBot(Disputer, config);
  if (config.botType == "monitor") return await executeBot(Monitor, config);
  throw new Error("Bot type not supported");
}
