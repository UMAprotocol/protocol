import winston from "winston";
import Web3 from "web3";

import { config } from "dotenv";

import retry from "async-retry";
const { getWeb3 } = require("@uma/common");
const { getAbi, getAddress } = require("@uma/core");
const {
  GasEstimator,
  Networker,
  Logger,
  createReferencePriceFeedForFinancialContract,
  createTokenPriceFeedForFinancialContract,
  waitForLogger,
  delay,
  DSProxyManager
} = require("@uma/financial-templates-lib");

const { RangeTrader } = require("./RangeTrader");
const { createExchangeAdapter } = require("./exchange-adapters/CreateExchangeAdapter");
import { TraderConfig } from "./TraderConfig";
config();

export async function run(logger: winston.Logger, web3: Web3): Promise<void> {
  try {
    const getTime = () => Math.round(new Date().getTime() / 1000);
    const config = new TraderConfig(process.env);

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[config.pollingDelay === 0 ? "debug" : "info"]({
      at: "Trader#index",
      message: "Trader started 🚜",
      financialContractAddress: config.financialContractAddress,
      pollingDelay: config.pollingDelay,
      errorRetries: config.errorRetries,
      errorRetriesTimeout: config.errorRetriesTimeout,
      dsProxyFactoryAddress: config.dsProxyFactoryAddress,
      tokenPriceFeedConfig: config.tokenPriceFeedConfig,
      referencePriceFeedConfig: config.referencePriceFeedConfig,
      exchangeAdapterConfig: config.exchangeAdapterConfig
    });

    // Load unlocked web3 accounts, get the networkId and set up price feed.
    const networker = new Networker(logger);
    const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);

    const gasEstimator = new GasEstimator(logger);

    const dsProxyManager = new DSProxyManager({
      logger,
      web3,
      gasEstimator,
      account: accounts[0],
      dsProxyFactoryAddress: config.dsProxyFactoryAddress || getAddress("DSProxyFactory", networkId),
      dsProxyFactoryAbi: getAbi("DSProxyFactory"),
      dsProxyAbi: getAbi("DSProxy")
    });
    await dsProxyManager.initializeDSProxy();

    const [tokenPriceFeed, referencePriceFeed, exchangeAdapter] = await Promise.all([
      createTokenPriceFeedForFinancialContract(
        logger,
        web3,
        networker,
        getTime,
        config.financialContractAddress,
        config.tokenPriceFeedConfig
      ),

      createReferencePriceFeedForFinancialContract(
        logger,
        web3,
        networker,
        getTime,
        config.financialContractAddress,
        config.referencePriceFeedConfig
      ),
      createExchangeAdapter(logger, web3, dsProxyManager, config.exchangeAdapterConfig, networkId)
    ]);
    const rangeTrader = new RangeTrader(logger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter);
    for (;;) {
      await retry(
        async () => {
          // Update the price feeds & gasEstimator.
          await Promise.all([tokenPriceFeed.update(), referencePriceFeed.update(), gasEstimator.update()]);

          // Check if a trade should be done. If so, trade.
          await rangeTrader.checkRangeMovementsAndTrade();
        },
        {
          retries: config.errorRetries,
          minTimeout: config.errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: error => {
            logger.debug({
              at: "Trader#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error
            });
          }
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (config.pollingDelay === 0) {
        logger.debug({
          at: "Trader#index",
          message: "End of serverless execution loop - terminating process"
        });
        await waitForLogger(logger);
        await delay(2); // waitForLogger does not always work 100% correctly in serverless. add a delay to ensure logs are captured upstream.
        break;
      }
      logger.debug({
        at: "Trader#index",
        message: "End of execution loop - waiting polling delay",
        pollingDelay: `${config.pollingDelay} (s)`
      });
      await delay(Number(config.pollingDelay));
    }
  } catch (error) {
    // If any error is thrown, catch it and bubble up to the main try-catch for error processing in the Poll function.
    throw typeof error === "string" ? new Error(error) : error;
  }
}

if (require.main === module) {
  run(Logger, getWeb3())
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      Logger.error({
        at: "Trader#index",
        message: "Trader execution error🚨",
        error: typeof error === "string" ? new Error(error) : error
      });
      process.exit(1);
    });
}
