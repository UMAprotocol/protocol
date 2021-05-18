// Config builder that constructs whitelists and bot configs. Used to parameterize the strategy runner.
import lodash from "lodash";

import Web3 from "web3";
const { toChecksumAddress } = Web3.utils;

import { getWeb3 } from "@uma/common";
import { getAbi } from "@uma/core";

import { liquidatorConfig, disputerConfig, monitorConfig } from "./BotEntryWrapper";
import nodeFetch from "node-fetch";
import assert from "assert";

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
  botConcurrency?: number;
  strategyTimeout?: number;
  verboseLogs?: boolean;
  emitDebugLogs?: boolean;
  globalAddressWhitelistUrls?: Array<string>;
  globalAddressWhitelist?: Array<string>;
  globalAddressBlacklist?: Array<string>;
  commonConfig?: { [key: string]: any };
  liquidatorSettings?: botSettings;
  disputerSettings?: botSettings;
  monitorSettings?: botSettings;
}

// The global whitelist is the concatenation of the any `globalAddressWhitelist` plus any values stored on remote json
// files define in `globalAddressWhitelistUrls`.
export async function buildGlobalWhitelist(config: strategyRunnerConfig) {
  let whitelist = config.globalAddressWhitelist ? config.globalAddressWhitelist : [];

  if (config.globalAddressWhitelistUrls) {
    const responses = await Promise.all(config.globalAddressWhitelistUrls.map((url: string) => nodeFetch(url)));
    const responseJson = await Promise.all(responses.map((response: any) => response.json()));
    responseJson.forEach((contractAddressesResponse: any) => {
      if (contractAddressesResponse.empWhitelist) whitelist = [...whitelist, ...contractAddressesResponse.empWhitelist];
      else throw new Error("Global Whitelist file does not have the `empWhitelist` key or is malformed");
    });
  }
  if (config.globalAddressBlacklist) whitelist = whitelist.filter((el) => !config.globalAddressBlacklist?.includes(el));
  return replaceAddressCase(whitelist);
}

// For an array of contracts and possible bot types within the `config`, fetch the synthetic names. Return a mapping
// of contract address to synthetic symbols to enrich logs produced by the bots.
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
  return replaceAddressCase(botConfigs);
}

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
    botTypeWhitelist = botTypeWhitelist.filter((el) => !config[settingsKey].addressBlacklist.includes(el));

  const botConfigs: any = [];
  botTypeWhitelist.forEach((contractAddress: string) => {
    const addressConfig = lodash.merge(
      config.commonConfig,
      config[settingsKey].commonConfig,
      config[settingsKey].addressConfigOverride ? config[settingsKey].addressConfigOverride[contractAddress] : null
    );
    const commonConfig = {
      botType,
      syntheticSymbol: syntheticSymbols[contractAddress],
      botIdentifier: `${syntheticSymbols[contractAddress]} ${botType}`,
      botNetwork: config.botNetwork,
      financialContractAddress: contractAddress,
      errorRetries: addressConfig.errorRetries,
      errorRetriesTimeout: addressConfig.errorRetriesTimeout,
      pollingDelay: 0,
      startingBlock: addressConfig.startingBlock ? addressConfig.startingBlock : process.env.STARTING_BLOCK_NUMBER,
      endingBlock: addressConfig.endingBlock ? addressConfig.endingBlock : process.env.ENDING_BLOCK_NUMBER,
    };
    if (botType == "liquidator") {
      const botConfig: liquidatorConfig = {
        ...commonConfig,
        priceFeedConfig: addressConfig.priceFeedConfig,
        liquidatorConfig: addressConfig.liquidatorConfig,
        liquidatorOverridePrice: addressConfig.liquidatorOverridePrice,
      };
      botConfigs.push(botConfig);
    }

    if (botType == "disputer") {
      const botConfig: disputerConfig = {
        ...commonConfig,
        priceFeedConfig: addressConfig.priceFeedConfig,
        disputerConfigConfig: addressConfig.disputerConfigConfig,
        disputerOverridePrice: addressConfig.disputerOverridePrice,
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
      };
      botConfigs.push(botConfig);
    }
  });
  return botConfigs;
}

// Takes in an object of any structure and returns the exact same object with all strings converted to check sum format.
function replaceAddressCase(object: any) {
  const stringifiedObject = JSON.stringify(object);
  const replacedStringifiedObject = stringifiedObject.replace(/0x[a-fA-F0-9]{40}/g, toChecksumAddress);
  return JSON.parse(replacedStringifiedObject);
}
