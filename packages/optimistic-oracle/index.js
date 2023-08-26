#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

const {
  Logger,
  delay,
  OptimisticOracleClient,
  GasEstimator,
  OptimisticOracleType,
} = require("@uma/financial-templates-lib");
const { OptimisticOracleProposer } = require("./src/proposer");

// Contract ABIs and network Addresses.
const { getWeb3 } = require("@uma/common");
const { getAbi, getAddress } = require("@uma/contracts-node");

// Types of oracles, used by the optimistic oracle proposer off-chain bot to determine if a price request has resolved.
// Note: Keys and valuesmust match the contract names listed in core/networks file so that this file can use them
// as input into getAbi and getAddress.
const OracleType = {
  VotingV2: "VotingV2", // Used on mainnet when optimistic oracle directly submits price requests to VotingV2.
  OracleChildTunnel: "OracleChildTunnel", // Used in production when running proposer bot on Polygon that needs to
  // bridge price requests back to L1.
  MockOracleAncillary: "MockOracleAncillary", // Used for testing when caller wants to be able to manually push prices
  // to resolve requests.
  OracleSpoke: "OracleSpoke", // Used in production for non-Polygon L2s to bridge price requests to L1.
  SkinnyOptimisticOracle: "SkinnyOptimisticOracle", // Gas-lite version of Optimistic oracle.
};

/**
 * @notice Runs strategies that propose and dispute prices for any price identifier serviced by the Optimistic Oracle.
 * @param {Object} logger Module responsible for sending logs.
 * @param {Object} web3 web3.js instance with unlocked wallets used for all on-chain connections.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Number} errorRetries The number of times the execution loop will re-try before throwing if an error occurs.
 * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
 * @param {Object} [commonPriceFeedConfig] Common configuration to pass to all PriceFeeds constructed by proposer.
 * @param {Number} [blocksPerEventSearch] Amount of blocks to search per web3 request.
 * @param {Object} [optimisticOracleProposerConfig] Configuration to construct the OptimisticOracle proposer.
 * @param {OracleType} [oracleType] Type of "Oracle" for this network, defaults to "VotingV2"
 * @param {OptimisticOracleType} [optimisticOracleType] Type of "OptimisticOracle" for this network, defaults to "OptimisticOracle"
 * @return None or throws an Error.
 */
async function run({
  logger,
  web3,
  pollingDelay,
  errorRetries,
  errorRetriesTimeout,
  commonPriceFeedConfig,
  blocksPerEventSearch,
  optimisticOracleProposerConfig,
  oracleType = OracleType.VotingV2,
  optimisticOracleType = OptimisticOracleType.OptimisticOracle,
  ignoredIdentifiersPostExpiry,
  ignoredIdentifiers,
}) {
  if (!Object.keys(OracleType).includes(oracleType)) throw new Error("Unexpected OracleType");
  try {
    const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);
    const optimisticOracleAddress = await getAddress(optimisticOracleType, networkId);
    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "OptimisticOracle#index",
      message: "OptimisticOracle proposer started 🔮",
      optimisticOracleAddress,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      commonPriceFeedConfig,
      blocksPerEventSearch,
      optimisticOracleProposerConfig,
      oracleType,
      optimisticOracleType,
    });

    // Create the OptimisticOracleClient to query on-chain information, GasEstimator to get latest gas prices and an
    // instance of the OO Proposer to respond to price requests and proposals.
    const optimisticOracleClient = new OptimisticOracleClient(
      logger,
      getAbi(optimisticOracleType),
      getAbi(oracleType),
      web3,
      optimisticOracleAddress,
      await getAddress(oracleType, networkId),
      604800, // default lookback setting for this client
      optimisticOracleType,
      blocksPerEventSearch ? Number(blocksPerEventSearch) : null
    );
    const gasEstimator = new GasEstimator(logger, 60, networkId);

    // Construct default price feed config passed to all pricefeeds constructed by the proposer.
    // The proposer needs to query prices for any identifier approved to use the Optimistic Oracle,
    // so a new pricefeed is constructed for each identifier. This `commonPriceFeedConfig` contains
    // properties that are shared across all of these new pricefeeds.
    const optimisticOracleProposer = new OptimisticOracleProposer({
      logger,
      optimisticOracleClient,
      gasEstimator,
      account: accounts[0],
      commonPriceFeedConfig,
      optimisticOracleProposerConfig,
      ignoredIdentifiersPostExpiry,
      ignoredIdentifiers,
    });

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    for (;;) {
      await retry(
        async () => {
          await optimisticOracleProposer.update();
          await optimisticOracleProposer.sendProposals();
          await optimisticOracleProposer.sendDisputes();
          await optimisticOracleProposer.settleRequests();
          return;
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: (error) => {
            logger.debug({
              at: "OptimisticOracle#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: "OptimisticOracle#index",
          message: "End of serverless execution loop - terminating process",
        });
        await delay(5); // Set a delay to let the transports flush fully.
        break;
      }
      logger.debug({
        at: "OptimisticOracle#index",
        message: "End of execution loop - waiting polling delay",
        pollingDelay: `${pollingDelay} (s)`,
      });
      await delay(Number(pollingDelay));
    }
  } catch (error) {
    // If any error is thrown, catch it and bubble up to the main try-catch for error processing in the Poll function.
    throw typeof error === "string" ? new Error(error) : error;
  }
}

async function Poll(callback) {
  try {
    // This object is spread when calling the `run` function below. It relies on the object enumeration order and must
    // match the order of parameters defined in the`run` function.
    const executionParameters = {
      // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
      // Default to 3 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 3,
      // Default to 10 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES_TIMEOUT ? Number(process.env.ERROR_RETRIES_TIMEOUT) : 1,
      // Amount of blocks to search per web3 request to fetch events. This can be used with providers that limit the
      // amount of blocks that can be fetched per request, including Arbitrum Infura nodes. Defaults to null which
      // searches the maximum amount of blocks.
      blocksPerEventSearch: process.env.MAX_BLOCKS_PER_EVENT_SEARCH,
      // Common price feed configuration passed along to all those constructed by proposer.
      commonPriceFeedConfig: process.env.COMMON_PRICE_FEED_CONFIG
        ? JSON.parse(process.env.COMMON_PRICE_FEED_CONFIG)
        : {},
      // If there is an optimistic oracle config, add it. Else, set to null. Example config:
      // {
      //   "disputePriceErrorPercent":0.05, -> Proposal prices that do not equal the dispute price
      //                                      within this error % will be disputed.
      //                                      e.g. 0.05 implies 5% margin of error.
      //   "otherAccountsToSettle": ["0x1234", "0x5678"] -> Other accounts for which this bot will call settle.
      //  }
      optimisticOracleProposerConfig: process.env.OPTIMISTIC_ORACLE_PROPOSER_CONFIG
        ? JSON.parse(process.env.OPTIMISTIC_ORACLE_PROPOSER_CONFIG)
        : {},
      // Type of "Oracle" to that optimistic oracle on this network submits price requests to, default is "VotingV2".
      // The other possible types are exported in an enum in this file.
      oracleType: process.env.ORACLE_TYPE ? process.env.ORACLE_TYPE : OracleType.VotingV2,
      // Type of "OptimisticOracle" to load in client, default is OptimisticOracle. The other possible types are
      // exported in an enum from financial-templates-lib/OptimisticOracleClient.
      optimisticOracleType: process.env.OPTIMISTIC_ORACLE_TYPE
        ? process.env.OPTIMISTIC_ORACLE_TYPE
        : OptimisticOracleType.OptimisticOracle,

      // The optimistic oracle proposer should skip proposing prices for some identifiers, for expired EMP contracts,
      // because they map to self-referential pricefeeds pre-expiry, but have different price resolution ogic post-expiry.
      // For example, please see [UMIP47](https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-47.md):
      // - "The type of price that the DVM will return is dependent on the timestamp the price request is made at. This
      //   timestamp is the expiry timestamp of the contract that is intended to use this price identifier, so the TWAP
      //   calculation is used pre-expiry and the closing index value of uSTONKS calculation is used at expiry."
      // A sample of identifiers that should be avoided for these reasons is here:
      // https://github.com/UMAprotocol/protocol/blob/4806b51d830466c445560f83196d5918af820a98/packages/common/src/PriceIdentifierUtils.ts#L38-L47
      ignoredIdentifiersPostExpiry: process.env.OPTIMISTIC_ORACLE_IGNORE_POST_EXPIRY
        ? JSON.parse(process.env.OPTIMISTIC_ORACLE_IGNORE_POST_EXPIRY)
        : [],

      // The bot will error on any request/proposal that it cannot verify. This means the operator should
      // add any identifiers to their environment that the bot does not have the capability to verify or if they wish
      // to ignore the identifiers for some other reason. See a sample list here:
      // https://github.com/UMAprotocol/protocol/blob/4806b51d830466c445560f83196d5918af820a98/packages/common/src/PriceIdentifierUtils.ts#L50-L68
      ignoredIdentifiers: process.env.OPTIMISTIC_ORACLE_IGNORE ? JSON.parse(process.env.OPTIMISTIC_ORACLE_IGNORE) : [],
    };

    await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "OptimisticOracle#index",
      message: "OO proposer execution error🚨",
      error: typeof error === "string" ? new Error(error) : error,
      notificationPath: "infrastructure-error",
    });
    await delay(5); // Set a delay to let the transports flush fully.
    callback(error);
  }
  callback();
}

function nodeCallback(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  } else process.exit(0);
}

// If called directly by node, execute the Poll Function. This lets the script be run as a node process.
if (require.main === module) {
  Poll(nodeCallback)
    .then(() => {})
    .catch(nodeCallback);
}

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
