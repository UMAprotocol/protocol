import winston from "winston";
import Web3 from "web3";
import retry from "async-retry";
import { config } from "dotenv";

import { getWeb3 } from "@uma/common";
import {
  GasEstimator,
  Logger,
  waitForLogger,
  delay,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
} from "@uma/financial-templates-lib";
import { getAbi } from "@uma/contracts-node";

import { Relayer } from "./Relayer";
import { RelayerConfig } from "./RelayerConfig";
config();

export async function run(logger: winston.Logger, web3: Web3): Promise<void> {
  try {
    const config = new RelayerConfig(process.env);

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[config.pollingDelay === 0 ? "debug" : "info"]({
      at: "InsuredBridgeRelayer#index",
      message: "Relayer started 🌉",
      bridgePoolFactoryAddress: config.bridgeAdminAddress,
    });

    const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);
    console.log(`connected to ${accounts[0]} on ${networkId}`); // just show web3 connection works.

    const gasEstimator = new GasEstimator(logger);

    // Create L1/L2 clients to pull data to inform the relayer.
    // todo: add in start and ending block numbers (if need be).
    const l1Client = new InsuredBridgeL1Client(
      logger,
      getAbi("BridgeAdmin"),
      getAbi("BridgePool"),
      web3,
      config.bridgeAdminAddress
    );

    // Fetch the deposit contract address from the bridge admin.
    const bridgeDepositBoxAddress = await new web3.eth.Contract(
      getAbi("BridgeAdmin"),
      config.bridgeAdminAddress
    ).methods
      .depositContract()
      .call();

    const l2Client = new InsuredBridgeL2Client(logger, getAbi("OVM_BridgeDepositBox"), web3, bridgeDepositBoxAddress);

    const relayer = new Relayer(logger, web3, l1Client, l2Client);

    for (;;) {
      await retry(
        async () => {
          // Update state.
          await Promise.all([gasEstimator.update(), l1Client.update(), l2Client.update()]);

          await relayer.relayPendingDeposits();
        },
        {
          retries: config.errorRetries,
          minTimeout: config.errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: (error) => {
            logger.debug({
              at: "InsuredBridgeRelayer#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (config.pollingDelay === 0) {
        logger.debug({
          at: "InsuredBridgeRelayer#index",
          message: "End of serverless execution loop - terminating process",
        });
        await waitForLogger(logger);
        await delay(2);
        break;
      }
      logger.debug({
        at: "InsuredBridgeRelayer#index",
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
        at: "InsuredBridgeRelayer#index",
        message: "InsuredBridgeRelayer execution error🚨",
        error: typeof error === "string" ? new Error(error) : error,
      });
      process.exit(1);
    });
}
