import program from "commander";
import nodeFetch from "node-fetch";
import assert from "assert";
import lodash from "lodash";
import * as fs from "fs";
import * as cliProgress from "cli-progress";
import bluebird from "bluebird";

import { Logger, delay } from "@uma/financial-templates-lib";

import { strategyRunnerConfig, buildBotConfigs, buildGlobalWhitelist } from "./ConfigBuilder";
import { runBot, liquidatorConfig, disputerConfig, monitorConfig } from "./BotEntryWrapper";

// Defaults for bot execution. If the user does not define these then these settings will be used.
const defaultPollingDelay = 300;
const defaultStrategyTimeout = 120;
const defaultBotConcurrency = 10;
const defaultNetwork = "mainnet_mnemonic";

// Global progress bar to show the status of the strategy runner during its execution.
let counter = 0;
const progressBar = new cliProgress.SingleBar(
  { format: "[{bar}] {percentage}% | bots executed: {value}/{total} | recent execution: {botIdentifier}" },
  cliProgress.Presets.shades_classic
);

// Main entry point that takes in a strategyRunnerConfig and executes bots within an execution while loop.
async function runStrategies(strategyRunnerConfig: strategyRunnerConfig) {
  strategyRunnerConfig = _setConfigDefaults(strategyRunnerConfig); // Default important configs. User configs take preference.
  if (strategyRunnerConfig.emitRunnerLogs)
    Logger.debug({
      at: "BotStrategyRunner",
      message: "Bot strategy runner started 🤖",
      strategyRunnerConfig: strategyRunnerConfig,
    });

  // Generate a global whitelist of addresses that all enabled bots will run on.
  const globalWhiteList = await buildGlobalWhitelist(strategyRunnerConfig);

  // Construct bot configs for all enabled bots. This includes all bot specific overrides, whitelists, blacklists and any
  // extra settings defined in the config. See the readme for full details on what is possible with this config.
  const allBotsConfigs = await buildBotConfigs(globalWhiteList, strategyRunnerConfig);

  if (strategyRunnerConfig.emitRunnerLogs)
    Logger.debug({
      at: "BotStrategyRunner",
      message: "Constructed global bot settings and whitelist",
      concurrency: strategyRunnerConfig.botConcurrency,
      globalWhiteList,
      totalBotsToExecute: allBotsConfigs.length,
    });

  for (;;) {
    if (strategyRunnerConfig.emitRunnerLogs)
      Logger.debug({
        at: "BotStrategyRunner",
        message: "Executing set of bots concurrently",
        concurrency: strategyRunnerConfig.botConcurrency,
      });

    progressBar.start(allBotsConfigs.length, 0);

    // Execute all bots in a bluebird map with limited concurrency. Note that none of the `runBot` calls ever throw errors.
    // Rather, they indicate an error via an `error` key within the response. The promise.race between the `runBot` and
    // _rejectAfterDelay bounds how long a given strategy can run for.
    const executionResults = await bluebird.map(
      allBotsConfigs,
      (botConfig: liquidatorConfig | disputerConfig | monitorConfig) =>
        Promise.all([
          _updateProgressBar(botConfig), // As the promise progresses through bots update the progress bar.
          Promise.race([_rejectAfterDelay(strategyRunnerConfig.strategyTimeout, botConfig), runBot(botConfig)]),
        ]),
      {
        concurrency: strategyRunnerConfig.botConcurrency || defaultBotConcurrency,
      }
    );

    progressBar.stop();
    counter = 0;

    // Filter out all logs produced by the `_updateProgressBar` and flatten the output structure.
    const logResults = executionResults.reduce((acc: any, val: any) => acc.concat(val), []).filter((log: any) => log);

    // For each log produced, checked the output status. If there was an error then store the full log result.
    // Else, process the log. This considers the logging level defined by the config.
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
      validOutputs,
    });

    if (strategyRunnerConfig.pollingDelay === 0) {
      if (strategyRunnerConfig.emitRunnerLogs)
        Logger.debug({
          at: "BotStrategyRunner",
          message: "End of execution loop - terminating process",
        });

      await delay(5);
      break;
    }
    if (strategyRunnerConfig.emitRunnerLogs)
      Logger.debug({
        at: "BotStrategyRunner",
        message: "End of execution loop - ting polling delay",
        pollingDelay: `${strategyRunnerConfig.pollingDelay} (s)`,
      });
    await delay(Number(strategyRunnerConfig.pollingDelay));
  }
}

// Take in the user config options including config files or config URLs.
const processExecutionOptions = async () => {
  const options = program
    .option("-fc, --fileConfig <path>", "input path to JSON config file.")
    .option("-uc, --urlConfig <path>", "url to JSON config hosted online. Private resources use access token")
    .option("-at, --accessToken <string>", "access token to access private configs online. EG private a repo")
    .option("-n, --network <string>", "truffle/web3 network for all bots to use. Used to override botNetwork setting")
    .option("-k, --keys <string>", "provide an GCKMS key to unlock. Used exclusively when running within GCP")
    .parse(process.argv)
    .opts();

  let fileConfig: any = {},
    urlConfig: any = {},
    envConfig: any = {};

  if (options.fileConfig) fileConfig = JSON.parse(fs.readFileSync(options.fileConfig, { encoding: "utf8" }));

  if (options.urlConfig) {
    // Fetch the config from remote URL. use the access token for authorization.
    const response = await nodeFetch(`${options.urlConfig}`, {
      method: "GET",
      headers: options.accessToken
        ? {
            Authorization: `token ${options.accessToken}`,
            "Content-type": "application/json",
            Accept: "application/vnd.github.v3.raw",
            "Accept-Charset": "utf-8",
          }
        : {},
    });
    urlConfig = await response.json(); // extract JSON from the http response
    assert(!urlConfig.message && !urlConfig.error, `Could not fetch config! :${JSON.stringify(urlConfig)}`);
  }

  if (process.env.RUNNER_CONFIG) envConfig = JSON.parse(process.env.RUNNER_CONFIG);
  const mergedConfig = lodash.merge(fileConfig, urlConfig, envConfig);
  assert(mergedConfig != {}, "provide a file config, URL config or env config to run the strategy runner");
  return mergedConfig;
};

// Returns a promise that is resolved after `seconds` delay. Used to limit how long a spoke can run for.
const _rejectAfterDelay = (seconds: number | undefined, executionConfig: any) =>
  new Promise((resolve) => {
    setTimeout(resolve, (seconds ? seconds : defaultStrategyTimeout) * 1000, {
      error: "timeout",
      message: `The strategy call took longer than ${seconds} seconds to exit`,
      ...executionConfig,
    });
  });

// Take the output logs from a bot execution and filter them based on the logging level provided by the config.
// if `verboseLogs` is enabled then all logs produced by the strategy is returned. If `emitDebugLogs` is enabled then
// only the `message` from debug logs is returned, within an array. Else, only info level and above logs are returned.
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
    .filter((log) => log);
}

// Apply defaults to the strategyRunnerConfig.
function _setConfigDefaults(config: strategyRunnerConfig) {
  config.botNetwork = config.botNetwork ? config.botNetwork : defaultNetwork;
  config.strategyTimeout = config.strategyTimeout ?? defaultStrategyTimeout;
  config.botConcurrency = config.botConcurrency ?? defaultBotConcurrency;
  config.pollingDelay = config.pollingDelay ?? defaultPollingDelay;
  config.liquidatorSettings = config.liquidatorSettings ?? { enableBotType: false };
  config.disputerSettings = config.disputerSettings ?? { enableBotType: false };
  config.monitorSettings = config.monitorSettings ?? { enableBotType: false };
  config.emitRunnerLogs = config.emitRunnerLogs ?? true;
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
