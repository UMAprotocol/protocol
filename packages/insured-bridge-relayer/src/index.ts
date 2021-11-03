import winston from "winston";
import Web3 from "web3";
import retry from "async-retry";
import { config } from "dotenv";
import assert from "assert";

import { getWeb3, getWeb3ByChainId } from "@uma/common";
import {
  GasEstimator,
  Logger,
  waitForLogger,
  delay,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
} from "@uma/financial-templates-lib";

import { approveL1Tokens } from "./RelayerHelpers";
import { Relayer } from "./Relayer";
import { RelayerConfig } from "./RelayerConfig";
config();

export async function run(logger: winston.Logger, l1Web3: Web3): Promise<void> {
  try {
    const config = new RelayerConfig(process.env);

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[config.pollingDelay === 0 ? "debug" : "info"]({
      at: "InsuredBridgeRelayer#index",
      message: "Relayer started 🌉",
      config,
    });

    const [accounts] = await Promise.all([l1Web3.eth.getAccounts()]);

    const gasEstimator = new GasEstimator(logger);
    await gasEstimator.update();

    // Create L1/L2 clients to pull data to inform the relayer.
    // todo: add in start and ending block numbers (if need be).
    // todo: grab bridge admin from `getAddress`.
    const l1Client = new InsuredBridgeL1Client(logger, l1Web3, config.bridgeAdmin, config.rateModels);

    // TODO: Add a method to fetch all registered chainIDs from bridge admin to let the bot default to all chains when
    // the config does not include activatedChainIds.

    // For now, this bot only supports 1 L2 chain. In future we need to update the bot to create n number l2Clients for
    // each L2 client. Then, create n instances of `Relayer`.
    assert(config.activatedChainIds.length == 1, "bot only supports running on 1 l2 at a time for now");

    // Construct a web3 instance running on L2.
    const l2Web3 = getWeb3ByChainId(config.activatedChainIds[0]);
    const latestL2BlockNumber = await l2Web3.eth.getBlockNumber();
    const l2StartBlock = latestL2BlockNumber - config.l2BlockLookback;

    const l2Client = new InsuredBridgeL2Client(
      logger,
      l2Web3,
      await l1Client.getL2DepositBoxAddress(config.activatedChainIds[0]),
      config.activatedChainIds[0],
      l2StartBlock
    );

    // For all specified whitelisted L1 tokens that this relayer supports, approve the bridge pool to spend them. This
    // method will error if the bot runner has specified a L1 tokens that is not part of the Bridge Admin whitelist.
    await approveL1Tokens(
      logger,
      l1Web3,
      gasEstimator,
      accounts[0],
      config.bridgeAdmin,
      config.whitelistedRelayL1Tokens
    );

    const relayer = new Relayer(
      logger,
      gasEstimator,
      l1Client,
      l2Client,
      config.whitelistedRelayL1Tokens,
      accounts[0],
      config.whitelistedChainIds,
      config.deployTimestamps,
      config.l2BlockLookback
    );

    for (;;) {
      await retry(
        async () => {
          // Update state.
          await Promise.all([gasEstimator.update(), l1Client.update(), l2Client.update()]);

          // Start bots that are enabled.
          if (config.botModes.relayerEnabled) await relayer.checkForPendingDepositsAndRelay();
          else logger.debug({ at: "Relayer", message: "Relayer disabled" });

          if (config.botModes.disputerEnabled) await relayer.checkForPendingRelaysAndDispute();
          else logger.debug({ at: "Disputer", message: "Disputer disabled" });

          if (config.botModes.finalizerEnabled) await relayer.checkforSettleableRelaysAndSettle();
          else logger.debug({ at: "Finalizer", message: "Finalizer disabled" });
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
