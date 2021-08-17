import winston from "winston";
import Web3 from "web3";
import retry from "async-retry";
import { config } from "dotenv";
import MaticJs from "@maticnetwork/maticjs";
import { averageBlockTimeSeconds, getWeb3 } from "@uma/common";
import { getAddress, getAbi } from "@uma/core";
import { GasEstimator, Logger, waitForLogger, delay } from "@uma/financial-templates-lib";

import { Relayer } from "./Relayer";
import { RelayerConfig } from "./RelayerConfig";
config();

export async function run(logger: winston.Logger, web3: Web3): Promise<void> {
  try {
    const config = new RelayerConfig(process.env);

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[config.pollingDelay === 0 ? "debug" : "info"]({
      at: "FxTunnelRelayer#index",
      message: "Relayer started 🌉"
    });

    // Set up polygon web3.
    const polygonNodeUrl = `https://polygon-mainnet.infura.io/v3/${config.infuraApiKey}`
    const polygonNetworkId = 137;
    const polygonWeb3 = new Web3(polygonNodeUrl);
    const [
      polygonAverageBlockTime,
      polygonCurrentBlock
  ] = await Promise.all([
      averageBlockTimeSeconds(polygonNetworkId),
      polygonWeb3.eth.getBlock("latest")
    ]);
    const polygonLookbackBlocks = Math.ceil(config.lookback / polygonAverageBlockTime);
    const polygonEarliestBlockToQuery = Math.max(polygonCurrentBlock.number - polygonLookbackBlocks, 0);

    // Set up ethereum web3.
    const ethNodeUrl = `https://mainnet.infura.io/v3/${config.infuraApiKey}`
    const ethNetworkId = 1;
    const [
      accounts,
      ethAverageBlockTime,
      ethCurrentBlock
  ] = await Promise.all([
      web3.eth.getAccounts(), 
      averageBlockTimeSeconds(ethNetworkId),
      web3.eth.getBlock("latest")
    ]);
    const ethLookbackBlocks = Math.ceil(config.lookback / ethAverageBlockTime);
    const ethEarliestBlockToQuery = Math.max(ethCurrentBlock.number - ethLookbackBlocks, 0);

    const gasEstimator = new GasEstimator(logger);

    // Setup Polygon client:
    const maticPOSClient = new MaticJs.MaticPOSClient({
      network: "mainnet",
      version: "v1",
      maticProvider: polygonNodeUrl,
      parentProvider: ethNodeUrl,
    });
    // Note: we use a private member of maticPosClient, so we cast to get rid of the error.
    const castedMaticPOSClient = (maticPOSClient as unknown) as {
      posRootChainManager: typeof maticPOSClient["posRootChainManager"];
    };

    // Construct contracts that we'll pass to the Relayer bot.
    const oracleChildTunnel = new polygonWeb3.eth.Contract(
      getAbi("OracleChildTunnel"),
      getAddress("OracleChildTunnel", polygonNetworkId) || undefined
    );
    const oracleRootTunnel = new web3.eth.Contract(
      getAbi("OracleRootTunnel"),
      getAddress("OracleRootTunnel", ethNetworkId) || undefined
    )

    const relayer = new Relayer(
      logger, 
      accounts[0],
      gasEstimator,
      castedMaticPOSClient, 
      oracleChildTunnel, 
      oracleRootTunnel, 
      web3,
      ethEarliestBlockToQuery,
      polygonEarliestBlockToQuery,
    );

    for (;;) {
      await retry(
        async () => {
          // Update state.
          await Promise.all([gasEstimator.update()]);

          await relayer.relayMessage();
        },
        {
          retries: config.errorRetries,
          minTimeout: config.errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: (error) => {
            logger.debug({
              at: "FxTunnelRelayer#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (config.pollingDelay === 0) {
        logger.debug({
          at: "FxTunnelRelayer#index",
          message: "End of serverless execution loop - terminating process",
        });
        await waitForLogger(logger);
        await delay(2);
        break;
      }
      logger.debug({
        at: "FxTunnelRelayer#index",
        message: "End of execution loop - waiting polling delay",
        pollingDelay: `${config.pollingDelay} (s)`,
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
    .catch((error) => {
      Logger.error({
        at: "FxTunnelRelayer#index",
        message: "FxTunnelRelayer execution error🚨",
        error: typeof error === "string" ? new Error(error) : error,
      });
      process.exit(1);
    });
}
