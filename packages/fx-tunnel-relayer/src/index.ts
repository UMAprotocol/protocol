import winston from "winston";
import Web3 from "web3";
import retry from "async-retry";
import { config } from "dotenv";
import MaticJs from "@maticnetwork/maticjs";
import { averageBlockTimeSeconds, getWeb3 } from "@uma/common";
import { getAddress, getAbi } from "@uma/contracts-node";
import { GasEstimator, Logger, delay } from "@uma/financial-templates-lib";

import { Relayer } from "./Relayer";
import { RelayerConfig } from "./RelayerConfig";
config();

export async function run(logger: winston.Logger, web3: Web3): Promise<void> {
  try {
    const config = new RelayerConfig(process.env);

    // Set up ethereum web3.
    const [accounts, ethNetworkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);

    // Set up polygon web3. If polygon node URL is undefined, then default to setting it equal to the web3 instance.
    // This facilitates local testing where contracts are deployed to the same local network.
    const polygonNodeUrl = config.polygonNodeUrl;
    const polygonWeb3 = polygonNodeUrl !== "" ? new Web3(polygonNodeUrl) : web3;
    const polygonNetworkId = await polygonWeb3.eth.net.getId();
    const [polygonAverageBlockTime, polygonCurrentBlock] = await Promise.all([
      averageBlockTimeSeconds(undefined, polygonNetworkId),
      polygonWeb3.eth.getBlock("latest"),
    ]);
    const polygonLookbackBlocks = Math.ceil(config.lookback / polygonAverageBlockTime);
    const polygonEarliestBlockToQuery = Math.max(polygonCurrentBlock.number - polygonLookbackBlocks, 0);

    const gasEstimator = new GasEstimator(logger);

    // Setup Polygon client:
    const maticPOSClient = new MaticJs.MaticPOSClient({
      network: "mainnet",
      version: "v1",
      maticProvider: polygonWeb3.currentProvider,
      parentProvider: web3.currentProvider,
    });
    // Note: we use a private member of maticPosClient, so we cast to get rid of the error.
    const castedMaticPOSClient = (maticPOSClient as unknown) as {
      posRootChainManager: typeof maticPOSClient["posRootChainManager"];
    };

    // Construct contracts that we'll pass to the Relayer bot.
    const oracleChildTunnel = new polygonWeb3.eth.Contract(
      getAbi("OracleChildTunnel"),
      await getAddress("OracleChildTunnel", polygonNetworkId)
    );
    const oracleRootTunnel = new web3.eth.Contract(
      getAbi("OracleRootTunnel"),
      await getAddress("OracleRootTunnel", ethNetworkId)
    );

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[config.pollingDelay === 0 ? "debug" : "info"]({
      at: "FxTunnelRelayer#index",
      message: "Relayer started 🌉",
      oracleChildTunnel: oracleChildTunnel.options.address,
      oracleRootTunnel: oracleRootTunnel.options.address,
      polygonEarliestBlockToQuery: polygonEarliestBlockToQuery,
    });

    const relayer = new Relayer(
      logger,
      accounts[0],
      gasEstimator,
      castedMaticPOSClient,
      oracleChildTunnel,
      oracleRootTunnel,
      web3,
      polygonEarliestBlockToQuery
    );

    for (;;) {
      await retry(
        async () => {
          // Update state.
          await gasEstimator.update();

          await relayer.fetchAndRelayMessages();
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
        await delay(5); // Set a delay to let the transports flush fully.
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
