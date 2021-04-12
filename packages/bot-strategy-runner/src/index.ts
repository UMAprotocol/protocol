import { option, program } from "commander";
import nodeFetch from "node-fetch";
import assert = require("assert");
import * as fs from "fs";
import * as cliProgress from "cli-progress";
import * as bluebird from "bluebird";

import { Logger, delay } from "@uma/financial-templates-lib";

import { strategyRunnerConfig, buildBotConfigs, buildGlobalWhitelist, mergeConfig } from "./ConfigBuilder";
import { runBot } from "./BotEntryWrapper";

const defaultPollingDelay = 120; // Strategy runner runs every 2 mins.
const defaultStrategyTimeout = 60;
const defaultBotConcurrency = 10;
const defaultNetwork = "mainnet_mnemonic";

let counter = 0;
const progressBar = new cliProgress.SingleBar(
  { format: "[{bar}] {percentage}% | bots executed: {value}/{total} | recent execution: {botIdentifier}" },
  cliProgress.Presets.shades_classic
);

async function runStrategies(strategyRunnerConfig: strategyRunnerConfig) {
  strategyRunnerConfig = _setConfigDefaults(strategyRunnerConfig);
  Logger.debug({
    at: "BotStrategyRunner",
    message: "Starting bot strategy runner",
    strategyRunnerConfig: strategyRunnerConfig
  });

  const globalWhiteList = await buildGlobalWhitelist(strategyRunnerConfig);

  const allBotsConfigs = await buildBotConfigs(globalWhiteList, strategyRunnerConfig);

  Logger.debug({
    at: "BotStrategyRunner",
    message: "Constructed global bot settings and whitelist",
    concurrency: strategyRunnerConfig.botConcurrency,
    globalWhiteList,
    totalBotsToExecute: allBotsConfigs.length
  });

  for (;;) {
    Logger.debug({
      at: "BotStrategyRunner",
      message: "Executing set of bots concurrently",
      concurrency: strategyRunnerConfig.botConcurrency
    });

    progressBar.start(allBotsConfigs.length, 0);

    const executionResults = await bluebird.map(
      allBotsConfigs,
      (botConfig: any) =>
        Promise.all([
          _updateProgressBar(botConfig),
          Promise.race([_rejectAfterDelay(strategyRunnerConfig.strategyTimeout, botConfig), runBot(botConfig)])
        ]),
      {
        concurrency: strategyRunnerConfig.botConcurrency
      }
    );
    counter = 0;
    progressBar.stop();

    const logResults = executionResults.reduce((acc: any, val: any) => acc.concat(val), []).filter((log: any) => log);

    const rejectedOutputs: any = {};
    const validOutputs: any = {};

    logResults.forEach((result: any) => {
      if (result.error) rejectedOutputs[result.botIdentifier] = result;
      else validOutputs[result.botIdentifier] = _reduceLog(result, strategyRunnerConfig);
    });

    Logger.debug({
      at: "BotStrategyRunner",
      message: "All strategies have finished running",
      rejectedOutputs,
      validOutputs
    });

    if (strategyRunnerConfig.pollingDelay === 0) {
      Logger.debug({
        at: "BotStrategyRunner",
        message: "End of execution loop - terminating process"
      });

      await delay(2); // waitForLogger does not always work 100% correctly in serverless. add a delay to ensure logs are captured upstream.
      break;
    }
    Logger.debug({
      at: "BotStratergyRunner",
      message: "End of execution loop - waiting polling delay",
      pollingDelay: `${strategyRunnerConfig.pollingDelay} (s)`
    });
    await delay(Number(strategyRunnerConfig.pollingDelay));
  }
}

const processExecutionOptions = async () => {
  const options = program
    .option("-fc, --fileConfig <path>", "input path to JSON config file.")
    .option("-uc, --urlConfig <path>", "url to JSON config hosted online. Private resources use access token")
    .option("-at, --accessToken <string>", "access token to access private configs online. EG private a repo")
    .parse(process.argv)
    .opts();

  assert(options.fileConfig != undefined || options.urlConfig != undefined, "provide a file config or a URL config");

  let fileConfig: any = {},
    urlConfig: any = {};

  if (options.fileConfig) {
    fileConfig = JSON.parse(fs.readFileSync(options.fileConfig, { encoding: "utf8" }));
  }
  if (options.urlConfig) {
    const response = await nodeFetch(`${options.urlConfig}`, {
      method: "GET",
      headers: options.accessToken
        ? {
            Authorization: `token ${options.accessToken}`,
            "Content-type": "application/json",
            Accept: "application/vnd.github.v3.raw",
            "Accept-Charset": "utf-8"
          }
        : {}
    });
    urlConfig = await response.json(); // extract JSON from the http response
    console.log("urlConfig", urlConfig);
    assert(!urlConfig.message && !urlConfig.error, `Could not fetch config! :${JSON.stringify(urlConfig)}`);
  }
  return mergeConfig(fileConfig, urlConfig);
};

// Returns a promise that is rejected after seconds delay. Used to limit how long a spoke can run for.
const _rejectAfterDelay = (seconds: number | undefined, executionConfig: any) =>
  new Promise((resolve, _) => {
    setTimeout(resolve, (seconds ? seconds : defaultStrategyTimeout) * 1000, {
      error: "timeout",
      message: `The strategy call took longer than ${seconds} seconds to exit`,
      executionConfig
    });
  });

function _reduceLog(
  logOutput: { financialContractAddress: string; botIdentifier: string; logs: Array<any> },
  strategyRunnerConfig: strategyRunnerConfig
) {
  if (strategyRunnerConfig.verboseLogs) return logOutput;

  return logOutput.logs
    .map((logInstance: any) => {
      if (strategyRunnerConfig.emitDebugLogs) return logInstance.message;
      else if (logInstance.level !== "debug") return logInstance.message;
    })
    .filter(log => log);
}

function _setConfigDefaults(config: strategyRunnerConfig) {
  config.botNetwork = config.botNetwork ? config.botNetwork : defaultNetwork;
  config.strategyTimeout = config.strategyTimeout ? config.strategyTimeout : defaultStrategyTimeout;
  config.botConcurrency = config.botConcurrency ? config.botConcurrency : defaultBotConcurrency;
  config.pollingDelay = config.pollingDelay ? config.pollingDelay : defaultPollingDelay;
  return config;
}

async function _updateProgressBar(botConfig: any) {
  counter = counter + 1;
  progressBar.update(counter, { botIdentifier: `${botConfig.syntheticSymbol} ${botConfig.botType}` });
}

async function EntryPoint(callback: any) {
  const config = await processExecutionOptions();
  await runStrategies(config);

  callback();
}

function nodeCallback(err: any) {
  if (err) {
    console.error(err);
    process.exit(1);
  } else process.exit(0);
}

if (require.main === module) {
  EntryPoint(nodeCallback)
    .then(() => {
      return;
    })
    .catch(nodeCallback);
}

module.exports = EntryPoint;
