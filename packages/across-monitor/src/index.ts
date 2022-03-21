import winston from "winston";
import Web3 from "web3";
import retry from "async-retry";
import { config } from "dotenv";

import { getWeb3 } from "@uma/common";
import { getAddress } from "@uma/contracts-node";
import { Logger, delay, InsuredBridgeL1Client } from "@uma/financial-templates-lib";

import { AcrossMonitor } from "./AcrossMonitor";
import { AcrossMonitorConfig } from "./AcrossMonitorConfig";
config();

export async function run(logger: winston.Logger, l1Web3: Web3): Promise<void> {
  try {
    const config = new AcrossMonitorConfig(process.env);

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[config.pollingDelay === 0 ? "debug" : "info"]({
      at: "AcrossMonitor#index",
      message: "AcrossMonitor started 🔭",
      config,
    });

    // l1Client uses bridgeAdmin contract for bridge pool discovery.
    const bridgeAdminAddress = await getAddress("BridgeAdmin", config.bridgeAdminChainId);
    const l1Client = new InsuredBridgeL1Client(logger, l1Web3, bridgeAdminAddress, null);

    const acrossMonitor = new AcrossMonitor(logger, config, l1Client);

    for (;;) {
      await retry(
        async () => {
          // Updating acrossMonitor also updates l1Client for pool discovery.
          await acrossMonitor.update();

          // Start bots that are enabled.
          if (config.botModes.utilizationEnabled) await acrossMonitor.checkUtilization();
          else logger.debug({ at: "AcrossMonitor#Utilization", message: "Utilization monitor disabled" });

          if (config.botModes.unknownRelayersEnabled) await acrossMonitor.checkUnknownRelayers();
          else logger.debug({ at: "AcrossMonitor#UnknownRelayers", message: "UnknownRelayers monitor disabled" });
        },
        {
          retries: config.errorRetries,
          minTimeout: config.errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: (error) => {
            logger.debug({
              at: "AcrossMonitor#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (config.pollingDelay === 0) {
        logger.debug({
          at: "AcrossMonitor#index",
          message: "End of serverless execution loop - terminating process",
        });
        await delay(5); // Set a delay to let the transports flush fully.
        break;
      }
      logger.debug({
        at: "AcrossMonitor#index",
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
        at: "AcrossMonitor#index",
        message: "AcrossMonitor execution error🚨",
        error: typeof error === "string" ? new Error(error) : error,
        notificationPath: "infrastructure-error",
      });
      process.exit(1);
    });
}
