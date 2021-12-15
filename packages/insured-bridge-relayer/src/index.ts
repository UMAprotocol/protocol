import winston from "winston";
import Web3 from "web3";
import retry from "async-retry";
import { config } from "dotenv";
import assert from "assert";

import { getWeb3, getWeb3ByChainId, processTransactionPromiseBatch, getRetryWeb3sByChainId } from "@uma/common";

import {
  GasEstimator,
  Logger,
  waitForLogger,
  delay,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
} from "@uma/financial-templates-lib";

import { approveL1Tokens, pruneWhitelistedL1Tokens } from "./RelayerHelpers";
import { Relayer } from "./Relayer";
import { CrossDomainFinalizer } from "./CrossDomainFinalizer";
import { createBridgeAdapter } from "./canonical-bridge-adapters/CreateBridgeAdapter";
import { RelayerConfig } from "./RelayerConfig";
config();

export async function run(logger: winston.Logger, l1Web3: Web3): Promise<void> {
  try {
    const config = new RelayerConfig(process.env);

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.

    // The logger is having issues with logging nested BNs. Remove this for now. Is indirectly fixed in PR https://github.com/UMAprotocol/protocol/pull/3656
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const { rateModels, ...logableConfig } = config;
    logger[config.pollingDelay === 0 ? "debug" : "info"]({
      at: "AcrossRelayer#index",
      message: "Relayer started 🌉",
      logableConfig,
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
    const l2StartBlock = Math.max(0, latestL2BlockNumber - config.l2BlockLookback);
    const fallbackL2Web3s = getRetryWeb3sByChainId(config.activatedChainIds[0]);
    // Note: This will not construct duplicate Web3 objects for URL's in the Retry config that are the same as the
    // one used to construct l2Web3.
    logger.debug({
      at: "AcrossRelayer#index",
      message: `Constructed ${fallbackL2Web3s.length} fallback L2 web3 providers`,
    });
    const l2Client = new InsuredBridgeL2Client(
      logger,
      l2Web3,
      await l1Client.getL2DepositBoxAddress(config.activatedChainIds[0]),
      config.activatedChainIds[0],
      l2StartBlock,
      null,
      fallbackL2Web3s
    );
    // Update the L2 client and filter out tokens that are not whitelisted on the L2 from the whitelisted
    // L1 relay list.
    const filteredL1Whitelist = await pruneWhitelistedL1Tokens(
      logger,
      l1Client,
      l2Client,
      config.whitelistedRelayL1Tokens
    );

    // For all specified whitelisted L1 tokens that this relayer supports, approve the bridge pool to spend them. This
    // method will error if the bot runner has specified a L1 tokens that is not part of the Bridge Admin whitelist.
    await approveL1Tokens(logger, l1Web3, gasEstimator, accounts[0], config.bridgeAdmin, filteredL1Whitelist);

    const relayer = new Relayer(
      logger,
      gasEstimator,
      l1Client,
      l2Client,
      filteredL1Whitelist,
      accounts[0],
      config.whitelistedChainIds,
      config.l1DeployData,
      config.l2DeployData,
      config.l2BlockLookback
    );

    const canonicalBridgeAdapter = await createBridgeAdapter(logger, l1Web3, l2Web3);
    if (config.botModes.l1FinalizerEnabled) await canonicalBridgeAdapter.initialize();

    const crossDomainFinalizer = new CrossDomainFinalizer(
      logger,
      gasEstimator,
      l1Client,
      l2Client,
      canonicalBridgeAdapter,
      accounts[0],
      config.l2DeployData,
      config.crossDomainFinalizationThreshold
    );

    for (;;) {
      await retry(
        async () => {
          // Update state.
          await Promise.all([gasEstimator.update(), l1Client.update(), l2Client.update()]);

          // Start bots that are enabled.
          if (config.botModes.relayerEnabled) await relayer.checkForPendingDepositsAndRelay();
          else logger.debug({ at: "AcrossRelayer#Relayer", message: "Relayer disabled" });

          if (config.botModes.disputerEnabled) await relayer.checkForPendingRelaysAndDispute();
          else logger.debug({ at: "AcrossRelayer#Disputer", message: "Disputer disabled" });

          if (config.botModes.settlerEnabled) await relayer.checkforSettleableRelaysAndSettle();
          else logger.debug({ at: "AcrossRelayer#Finalizer", message: "Relay Settler disabled" });

          if (config.botModes.l1FinalizerEnabled) await crossDomainFinalizer.checkForConfirmedL2ToL1RelaysAndFinalize();
          else logger.debug({ at: "AcrossRelayer#CrossDomainFinalizer", message: "Confirmed L1 finalizer disabled" });

          if (config.botModes.l2FinalizerEnabled) await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
          else logger.debug({ at: "AcrossRelayer#CrossDomainFinalizer", message: "L2->L1 finalizer disabled" });

          // Each of the above code blocks could have produced transactions. If they did, their promises are stored
          // in the executed transactions array. The method below awaits all these transactions to ensure they are
          // correctly included in a block. if any submitted transactions contains an error then a log is produced.
          await processTransactionPromiseBatch(
            [...relayer.getExecutedTransactions(), ...crossDomainFinalizer.getExecutedTransactions()],
            logger
          );
          relayer.resetExecutedTransactions(); // Purge the executed transactions array for next execution loop.
        },

        {
          retries: config.errorRetries,
          minTimeout: config.errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: (error) => {
            logger.debug({
              at: "AcrossRelayer#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (config.pollingDelay === 0) {
        logger.debug({
          at: "AcrossRelayer#index",
          message: "End of serverless execution loop - terminating process",
        });
        await waitForLogger(logger);
        await delay(2);
        break;
      }
      logger.debug({
        at: "AcrossRelayer#index",
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
        at: "AcrossRelayer#index",
        message: "AcrossRelayer execution error🚨",
        error: typeof error === "string" ? new Error(error) : error,
      });
      process.exit(1);
    });
}
