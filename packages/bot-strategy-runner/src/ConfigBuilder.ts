const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");

import { liquidatorConfig, disputerConfig, monitorConfig } from "./BotEntryWrapper";
import nodeFetch from "node-fetch";
import assert = require("assert");

const supportedBotTypes = ["liquidator", "disputer", "monitor"];

export interface botSettings {
  enableBotType: boolean;
  addressWhitelist?: Array<string>;
  addressBlacklist?: Array<string>;
  commonConfig?: { [key: string]: any };
  addressConfigOverride?: { [key: string]: { [key: string]: any } };
}

export interface strategyRunnerConfig {
  botNetwork?: string;
  pollingDelay?: number;
  strategyRunnerPollingDelay?: number;
  botConcurrency?: number;
  strategyTimeout?: number;
  verboseLogs?: boolean;
  emitDebugLogs?: boolean;
  globalWhitelistUrls?: Array<string>;
  globalWhitelistAddresses?: Array<string>;
  globalAddressBlacklist?: Array<string>;
  commonConfig?: { [key: string]: any };
  liquidatorSettings?: botSettings;
  disputerSettings?: botSettings;
  monitorSettings?: botSettings;
}

// The global whitelist is the concatenation of the any globalWhitelistAddresses plus any values stored on remote json
// files define in globalWhitelistUrls.
export async function buildGlobalWhitelist(config: strategyRunnerConfig) {
  let whitelist = config.globalWhitelistAddresses ? config.globalWhitelistAddresses : [];

  if (config.globalWhitelistUrls) {
    const responses = await Promise.all(config.globalWhitelistUrls.map((url: string) => nodeFetch(url)));
    const responseJson = await Promise.all(responses.map((response: any) => response.json()));
    responseJson.forEach((contractAddressesResponse: any) => {
      if (contractAddressesResponse.empWhitelist) whitelist = [...whitelist, ...contractAddressesResponse.empWhitelist];
      else console.log("Global Whitelist file does not have the `empWhitelist` key or is malformed");
    });
  }
  if (config.globalAddressBlacklist) whitelist = whitelist.filter(el => !config.globalAddressBlacklist?.includes(el));
  return whitelist;
}

export async function fetchSynthNames(contractAddresses: Array<string>, config: any) {
  const web3 = getWeb3(config.botNetwork);

  let allPossibleAddresses = contractAddresses;
  supportedBotTypes.forEach((botType: string) => {
    if (config[`${botType}Settings`].addressWhitelist)
      allPossibleAddresses = [...allPossibleAddresses, ...config[`${botType}Settings`].addressWhitelist];
  });

  const syntheticTokenAddresses = await Promise.all(
    contractAddresses.map((financialContractAddress: string) => {
      const financialContract = new web3.eth.Contract(getAbi("ExpiringMultiParty"), financialContractAddress);
      return financialContract.methods.tokenCurrency().call();
    })
  );

  const syntheticSymbols = await Promise.all(
    syntheticTokenAddresses.map((syntheticTokenAddress: string) => {
      const syntheticToken = new web3.eth.Contract(getAbi("ExpandedERC20"), syntheticTokenAddress);
      return syntheticToken.methods.symbol().call();
    })
  );

  const syntheticsToSymbol: any = {};
  allPossibleAddresses.forEach((address: string, index: number) => {
    syntheticsToSymbol[address] = syntheticSymbols[index];
  });
  return syntheticsToSymbol;
}

export async function buildBotConfigs(globalWhitelist: Array<string>, config: strategyRunnerConfig) {
  let botConfigs: any = [];
  const syntheticSymbols = await fetchSynthNames(globalWhitelist, config);
  supportedBotTypes.forEach((botType: string) => {
    botConfigs = [...botConfigs, ...buildConfigForBotType(globalWhitelist, config, botType, syntheticSymbols)];
  });
  return botConfigs;
}

// TODO: update this method to accommodate upper and lower case addresses.
function buildConfigForBotType(
  globalWhitelist: Array<string>,
  config: any,
  botType: string,
  syntheticSymbols: { [key: string]: string }
) {
  assert(supportedBotTypes.includes(botType), `Only ${supportedBotTypes} supported!`);

  const settingsKey = `${botType}Settings`;

  // If this particular bot type is not enabled, return early.
  if (!config[settingsKey].enableBotType) return [];

  let botTypeWhitelist = globalWhitelist;

  if (config[settingsKey].addressWhitelist)
    botTypeWhitelist = [...globalWhitelist, ...config[settingsKey].addressWhitelist];

  if (config[settingsKey].addressBlacklist)
    botTypeWhitelist = botTypeWhitelist.filter(el => !config[settingsKey].addressBlacklist.includes(el));

  const botConfigs: any = [];
  botTypeWhitelist.forEach((contractAddress: string) => {
    const addressConfig = mergeConfig(
      config.commonConfig,
      config[settingsKey].commonConfig,
      config[settingsKey].addressConfigOverride ? config[settingsKey].addressConfigOverride[contractAddress] : null
    );
    const commonConfig = {
      botType,
      syntheticSymbol: syntheticSymbols[contractAddress],
      botNetwork: config.botNetwork,
      financialContractAddress: contractAddress,
      errorRetries: addressConfig.errorRetries,
      errorRetriesTimeout: addressConfig.errorRetriesTimeout,
      pollingDelay: 0
    };
    if (botType == "liquidator") {
      const botConfig: liquidatorConfig = {
        ...commonConfig,
        priceFeedConfig: addressConfig.priceFeedConfig,
        liquidatorConfig: addressConfig.liquidatorConfig,
        liquidatorOverridePrice: addressConfig.liquidatorOverridePrice,
        startingBlock: addressConfig.startingBlock,
        endingBlock: addressConfig.endingBlock
      };
      botConfigs.push(botConfig);
    }

    if (botType == "disputer") {
      const botConfig: disputerConfig = {
        ...commonConfig,
        priceFeedConfig: addressConfig.priceFeedConfig,
        disputerConfigConfig: addressConfig.disputerConfigConfig,
        disputerOverridePrice: addressConfig.disputerOverridePrice
      };
      botConfigs.push(botConfig);
    }
    if (botType == "monitor") {
      const botConfig: monitorConfig = {
        ...commonConfig,
        optimisticOracleAddress: addressConfig.optimisticOracleAddress,
        monitorConfigConfig: addressConfig.monitorConfigConfig,
        tokenPriceFeedConfig: addressConfig.tokenPriceFeedConfig,
        medianizerPriceFeedConfig: addressConfig.medianizerPriceFeedConfig,
        denominatorPriceFeedConfig: addressConfig.denominatorPriceFeedConfig,
        startingBlock: addressConfig.startingBlock,
        endingBlock: addressConfig.endingBlock
      };
      botConfigs.push(botConfig);
    }
  });
  return botConfigs;
}

export function mergeConfig(...args: any) {
  const target: any = {}; // create a new object

  // deep merge the object into the target object
  const merger = (obj: any) => {
    for (const prop in obj) {
      if ({}.hasOwnProperty.call(obj, prop)) {
        if (Object.prototype.toString.call(obj[prop]) === "[object Object]") {
          // if the property is a nested object
          target[prop] = mergeConfig(target[prop], obj[prop]);
        } else {
          // for regular property
          target[prop] = obj[prop];
        }
      }
    }
  };

  // iterate through all objects and deep merge them with target
  for (let i = 0; i < args.length; i++) {
    merger(args[i]);
  }

  return target;
}
