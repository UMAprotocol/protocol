import { config } from "dotenv";
config();
import retry from "async-retry";
import { getWeb3 } from "@uma/common";

// const { Logger, waitForLogger, delay, OptimisticOracleClient, GasEstimator } = require("@uma/financial-templates-lib");

// // Contract ABIs and network Addresses.
// const { getAbi, getAddress } = require("@uma/core");
// const { getWeb3 } = require("@uma/common");

// /**
//  * @notice Runs strategies that propose and dispute prices for any price identifier serviced by the Optimistic Oracle.
//  * @param {Object} logger Module responsible for sending logs.
//  * @param {Object} web3 web3.js instance with unlocked wallets used for all on-chain connections.
//  * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
//  *     mode which will exit after the loop.
//  * @param {Number} errorRetries The number of times the execution loop will re-try before throwing if an error occurs.
//  * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
//  * @return None or throws an Error.
//  */
// async function run({ logger, web3, pollingDelay, errorRetries, errorRetriesTimeout }) {
//   try {
//     const [networkId] = await Promise.all([web3.eth.net.getId()]);
//     const optimisticOracleAddress = getAddress("OptimisticOracle", networkId);
//     const votingAddress = getAddress("Voting", networkId);
//     // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
//     // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
//     logger[pollingDelay === 0 ? "debug" : "info"]({
//       at: "OptimisticOracle#index",
//       message: "OO keeper started 🌊",
//       optimisticOracleAddress,
//       pollingDelay,
//       errorRetries,
//       errorRetriesTimeout
//     });

//     // TODO:
//     // - Miscellaneous setup
//     // - Construct OO Keeper bot
//     // - Set appropriate allowances

//     // Create the OptimisticOracleClient to query on-chain information, GasEstimator to get latest gas prices and an
//     // instance of the OO Keeper to respond to price requests and proposals.
//     const ooClient = new OptimisticOracleClient(
//       logger,
//       getAbi("OptimisticOracle"),
//       getAbi("Voting"),
//       web3,
//       optimisticOracleAddress,
//       votingAddress
//     );
//     const gasEstimator = new GasEstimator(logger);

//     // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
//     for (;;) {
//       await retry(
//         async () => {
//           await gasEstimator.update();
//           // Placeholder for looping logic that should be implemented in this bot in future PR's.
//           await ooClient.update();
//           return;
//         },
//         {
//           retries: errorRetries,
//           minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
//           randomize: false,
//           onRetry: error => {
//             logger.debug({
//               at: "OptimisticOracle#index",
//               message: "An error was thrown in the execution loop - retrying",
//               error: typeof error === "string" ? new Error(error) : error
//             });
//           }
//         }
//       );
//       // If the polling delay is set to 0 then the script will terminate the bot after one full run.
//       if (pollingDelay === 0) {
//         logger.debug({
//           at: "OptimisticOracle#index",
//           message: "End of serverless execution loop - terminating process"
//         });
//         await waitForLogger(logger);
//         break;
//       }
//       logger.debug({
//         at: "OptimisticOracle#index",
//         message: "End of execution loop - waiting polling delay",
//         pollingDelay: `${pollingDelay} (s)`
//       });
//       await delay(Number(pollingDelay));
//     }
//   } catch (error) {
//     // If any error is thrown, catch it and bubble up to the main try-catch for error processing in the Poll function.
//     throw typeof error === "string" ? new Error(error) : error;
//   }
// }

// async function Poll(callback) {
//   try {
//     // This object is spread when calling the `run` function below. It relies on the object enumeration order and must
//     // match the order of parameters defined in the`run` function.
//     const executionParameters = {
//       // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
//       pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
//       // Default to 3 re-tries on error within the execution loop.
//       errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 5,
//       // Default to 10 seconds in between error re-tries.
//       errorRetriesTimeout: process.env.ERROR_RETRIES_TIMEOUT ? Number(process.env.ERROR_RETRIES_TIMEOUT) : 10
//     };

//     await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
//   } catch (error) {
//     Logger.error({
//       at: "OptimisticOracle#index",
//       message: "OO keeper execution error🚨",
//       error: typeof error === "string" ? new Error(error) : error
//     });
//     await waitForLogger(Logger);
//     callback(error);
//   }
//   callback();
// }

// function nodeCallback(err) {
//   if (err) {
//     console.error(err);
//     process.exit(1);
//   } else process.exit(0);
// }

// // If called directly by node, execute the Poll Function. This lets the script be run as a node process.
// if (require.main === module) {
//   Poll(nodeCallback)
//     .then(() => {})
//     .catch(nodeCallback);
// }

// // Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
// Poll.run = run;
// module.exports = Poll;

export async function run() {
  await retry(async () => {}, {
              retries: 3,
              minTimeout: 5 * 1000, // delay between retries in ms
              randomize: false,
              onRetry: (error: Error, attempt: number) => {
                console.log(error, attempt);
              }
            });
};

if (require.main === module) {
  run().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
