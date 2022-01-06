import winston from "winston";
import Web3 from "web3";
import retry from "async-retry";
import { config } from "dotenv";
import lodash from "lodash";

import { getWeb3, getWeb3ByChainId, processTransactionPromiseBatch, getRetryWeb3sByChainId } from "@uma/common";

import {
  GasEstimator,
  Logger,
  delay,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
} from "@uma/financial-templates-lib";

import { Relayer } from "./Relayer";
import { approveL1Tokens, pruneWhitelistedL1Tokens } from "./RelayerHelpers";
import { ProfitabilityCalculator } from "./ProfitabilityCalculator";
import { CrossDomainFinalizer } from "./CrossDomainFinalizer";
import { createBridgeAdapter } from "./canonical-bridge-adapters/CreateBridgeAdapter";
import { RelayerConfig } from "./RelayerConfig";
import { MulticallBundler } from "./MulticallBundler";
import { isErrorOutput } from "./helpers";
config();

export async function run(logger: winston.Logger, l1Web3: Web3): Promise<void> {
  try {
    const config = new RelayerConfig(process.env);

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.

    logger[config.pollingDelay === 0 ? "debug" : "info"]({
      at: "AcrossRelayer#index",
      message: "Relayer started 🌉",
      config,
    });

    const [accounts, l1ChainId] = await Promise.all([l1Web3.eth.getAccounts(), await l1Web3.eth.getChainId()]);

    const gasEstimator = new GasEstimator(logger, 60, l1ChainId, l1Web3);
    await gasEstimator.update();

    const multicallBundler = new MulticallBundler(logger, gasEstimator, l1Web3, accounts[0]);

    // Create L1/L2 clients to pull data to inform the relayer.
    // todo: add in start and ending block numbers (if need be).
    // todo: grab bridge admin from `getAddress`.
    const l1Client = new InsuredBridgeL1Client(logger, l1Web3, config.bridgeAdmin, config.rateModelStore);
    await l1Client.update();

    // TODO: Add a method to fetch all registered chainIDs from bridge admin to let the bot default to all chains when
    // the config does not include activatedChainIds.

    const relayers = await Promise.all(
      config.activatedChainIds.map(async (chainId: number) => {
        // Construct a web3 instance running on L2.
        const l2Web3 = getWeb3ByChainId(chainId);
        const latestL2BlockNumber = await l2Web3.eth.getBlockNumber();
        const l2StartBlock = Math.max(0, latestL2BlockNumber - config.l2BlockLookback);
        const fallbackL2Web3s = getRetryWeb3sByChainId(chainId);
        // Note: This will not construct duplicate Web3 objects for URL's in the Retry config that are the same as the
        // one used to construct l2Web3.
        logger.debug({
          at: "AcrossRelayer#index",
          message: `Constructed ${fallbackL2Web3s.length} fallback L2 web3 providers`,
        });
        const l2Client = new InsuredBridgeL2Client(
          logger,
          l2Web3,
          await l1Client.getL2DepositBoxAddress(chainId),
          chainId,
          l2StartBlock,
          null,
          fallbackL2Web3s
        );
        await l2Client.update();

        // Update the clients and filter out tokens that are not whitelisted on the L2 from the whitelisted
        // L1 relay list. Whitelisted tokens are fetched from the L1 RateModelStore contract.
        const filteredL1Whitelist = await pruneWhitelistedL1Tokens(logger, l1Client, l2Client);

        // Construct the profitability calculator based on the filteredL1Whitelist and relayerDiscount.
        const profitabilityCalculator = new ProfitabilityCalculator(
          logger,
          filteredL1Whitelist,
          l1ChainId,
          l1Web3,
          config.relayerDiscount
        );

        const relayer = new Relayer(
          logger,
          gasEstimator,
          l1Client,
          l2Client,
          profitabilityCalculator,
          filteredL1Whitelist,
          accounts[0],
          config.whitelistedChainIds,
          config.l1DeployData,
          config.l2DeployData,
          config.l2BlockLookback,
          multicallBundler
        );

        const canonicalBridgeAdapter = createBridgeAdapter(logger, l1Web3, l2Web3, chainId);
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

        return {
          relayer,
          crossDomainFinalizer,
          l2Client,
          profitabilityCalculator,
          filteredL1Whitelist,
        };
      })
    );

    // For all specified whitelisted L1 tokens that this relayer supports, approve the bridge pool to spend them. This
    // method will error if the bot runner has specified a L1 tokens that is not part of the Bridge Admin whitelist.
    const combinedFilteredL1Whitelist = lodash.uniq(relayers.map((relayer) => relayer.filteredL1Whitelist).flat());
    await approveL1Tokens(logger, l1Web3, gasEstimator, accounts[0], config.bridgeAdmin, combinedFilteredL1Whitelist);
    for (;;) {
      const outputs = await Promise.allSettled(
        relayers.map(async ({ relayer, crossDomainFinalizer, l2Client, profitabilityCalculator }) => {
          await retry(
            async () => {
              // Update state.
              await Promise.all([
                gasEstimator.update(),
                l1Client.update(),
                l2Client.update(),
                profitabilityCalculator.update(),
              ]);

              // Start bots that are enabled.
              if (config.botModes.relayerEnabled) await relayer.checkForPendingDepositsAndRelay();
              else logger.debug({ at: "AcrossRelayer#Relayer", message: "Relayer disabled" });

              if (config.botModes.disputerEnabled) await relayer.checkForPendingRelaysAndDispute();
              else logger.debug({ at: "AcrossRelayer#Disputer", message: "Disputer disabled" });

              if (config.botModes.settlerEnabled) await relayer.checkforSettleableRelaysAndSettle();
              else logger.debug({ at: "AcrossRelayer#Finalizer", message: "Relay Settler disabled" });

              if (config.botModes.l1FinalizerEnabled)
                await crossDomainFinalizer.checkForConfirmedL2ToL1RelaysAndFinalize();
              else
                logger.debug({
                  at: "AcrossRelayer#CrossDomainFinalizer",
                  message: "Confirmed L1 finalizer disabled",
                });

              if (config.botModes.l2FinalizerEnabled) await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
              else logger.debug({ at: "AcrossRelayer#CrossDomainFinalizer", message: "L2->L1 finalizer disabled" });
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
        })
      );

      // The multicall bundler may have accrued transactions over the course of the run.
      // This call fires off those transactions, but does not wait on them to be mined.
      // Note: we wait until this point to actually send off the transactions to make bundles as large as possible.
      await multicallBundler.send();

      // Each of the above code blocks could have produced transactions. If they did, their promises are stored
      // in the executed transactions array. The method below awaits all these transactions to ensure they are
      // correctly included in a block. if any submitted transactions contains an error then a log is produced.
      const allCrossDomainTxns = relayers
        .map(({ crossDomainFinalizer }) => crossDomainFinalizer.getExecutedTransactions())
        .flat();
      await processTransactionPromiseBatch(allCrossDomainTxns, logger);
      await multicallBundler.waitForMine();

      if (outputs.some(isErrorOutput))
        throw new Error(
          `Multiple errors: ${outputs
            .filter(isErrorOutput)
            .map((output) => output.reason.message)
            .join("\n")}`
        );

      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (config.pollingDelay === 0) {
        logger.debug({
          at: "AcrossRelayer#index",
          message: "End of serverless execution loop - terminating process",
        });
        await delay(5); // Set a delay to let the transports flush fully.
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
