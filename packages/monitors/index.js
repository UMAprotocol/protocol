#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

// Clients to retrieve on-chain data and helpers.
const {
  FinancialContractClient,
  FinancialContractEventClient,
  OptimisticOracleEventClient,
  TokenBalanceClient,
  Networker,
  Logger,
  createReferencePriceFeedForFinancialContract,
  createTokenPriceFeedForFinancialContract,
  delay,
  multicallAddressMap,
  OptimisticOracleType,
  waitForLogger,
} = require("@uma/financial-templates-lib");

// Monitor modules to report on client state changes.
const { OptimisticOracleContractMonitor } = require("./src/OptimisticOracleContractMonitor");
const { ContractMonitor } = require("./src/ContractMonitor");
const { BalanceMonitor } = require("./src/BalanceMonitor");
const { CRMonitor } = require("./src/CRMonitor");
const { SyntheticPegMonitor } = require("./src/SyntheticPegMonitor");

// Contract ABIs and network Addresses.
const { findContractVersion } = require("@uma/core");
const { getAddress, getAbi } = require("@uma/contracts-node");
const {
  getWeb3,
  SUPPORTED_CONTRACT_VERSIONS,
  PublicNetworks,
  getContractsNodePackageAliasForVerion,
} = require("@uma/common");

/**
 * @notice Continuously attempts to monitor contract positions and reports based on monitor modules.
 * @param {Object} logger Module responsible for sending logs.
 * @param {String} financialContractAddress Contract address of the Financial Contract.
 * @param {String} optimisticOracleAddress Contract address of the OptimisticOracle Contract.
 * @param {OptimisticOracleType} [optimisticOracleType] Type of "OptimisticOracle" for this network, defaults to "OptimisticOracle"
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Number} errorRetries The number of times the execution loop will re-try before throwing if an error occurs.
 * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
 * @param {Number} startingBlock Offset block number to define where the monitor bot should start searching for events
 *     from. If 0 will look for all events back to deployment of the Financial Contract. If set to null uses current block number.
 * @param {Number} endingBlock Termination block number to define where the monitor bot should end searching for events.
 *     If `null` then will search up until the latest block number in each loop.
 * @param {Number} blocksPerEventSearch Amount of blocks to search per web3 request.
 * @param {Object} monitorConfig Configuration object to parameterize all monitor modules.
 * @param {Object} tokenPriceFeedConfig Configuration to construct the tokenPriceFeed (balancer or uniswap) price feed object.
 * @param {Object} medianizerPriceFeedConfig Configuration to construct the reference price feed object.
 * @param {Object} denominatorPriceFeedConfig Configuration to construct the denominator price feed object.
 * @return None or throws an Error.
 */
async function run({
  logger,
  web3,
  financialContractAddress,
  optimisticOracleType,
  optimisticOracleAddress,
  pollingDelay,
  errorRetries,
  errorRetriesTimeout,
  startingBlock,
  endingBlock,
  blocksPerEventSearch,
  monitorConfig,
  tokenPriceFeedConfig,
  medianizerPriceFeedConfig,
  denominatorPriceFeedConfig,
}) {
  try {
    const { hexToUtf8 } = web3.utils;

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "Monitor#index",
      message: "Monitor started 🕵️‍♂️",
      financialContractAddress,
      optimisticOracleAddress,
      optimisticOracleType,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      startingBlock,
      endingBlock,
      blocksPerEventSearch,
      monitorConfig,
      tokenPriceFeedConfig,
      medianizerPriceFeedConfig,
      denominatorPriceFeedConfig,
    });

    const getTime = () => Math.round(new Date().getTime() / 1000);

    /** *************************************
     *
     * Set variables common to all monitors
     *
     ***************************************/
    const [networkId, latestBlock, chainId] = await Promise.all([
      web3.eth.net.getId(),
      web3.eth.getBlock("latest"),
      web3.eth.getChainId(),
    ]);
    const networkName = PublicNetworks[Number(networkId)] ? PublicNetworks[Number(networkId)].name : null; // If startingBlock is set to null then use the `latest` block number for the `eventsFromBlockNumber` and leave the
    // `endingBlock` as null.
    const eventsFromBlockNumber = startingBlock ? startingBlock : latestBlock.number;
    if (!monitorConfig) monitorConfig = {};

    // List of promises to run in parallel during each iteration, each of which represents a monitor executing.
    let monitorRunners = [];
    // At the beginning of each iteration, we'll need to repopulate the `monitorRunners` array with promises
    // to run in parallel.
    let populateMonitorRunnerHelpers = [];

    /** *************************************
     *
     * Financial Contract Runner
     *
     ***************************************/
    if (financialContractAddress) {
      const [detectedContract] = await Promise.all([findContractVersion(financialContractAddress, web3)]);

      // Append the contract version and type to the monitorConfig, if the monitorConfig does not already contain one.
      if (!monitorConfig.contractVersion) monitorConfig.contractVersion = detectedContract.contractVersion;
      if (!monitorConfig.contractType) monitorConfig.contractType = detectedContract.contractType;

      // Check that the version and type is supported. Note if either is null this check will also catch it.
      if (
        SUPPORTED_CONTRACT_VERSIONS.filter(
          (vo) => vo.contractType == monitorConfig.contractType && vo.contractVersion == monitorConfig.contractVersion
        ).length == 0
      )
        throw new Error(
          `Contract version specified or inferred is not supported by this bot. Monitor config:${JSON.stringify(
            monitorConfig
          )} & detectedContractVersion:${JSON.stringify(detectedContract)} is not part of ${JSON.stringify(
            SUPPORTED_CONTRACT_VERSIONS
          )}`
        );

      // Setup contract instances.
      const voting = new web3.eth.Contract(getAbi("Voting"), getAddress("Voting", networkId));
      const { getAbi: getVersionedAbi } = require(getContractsNodePackageAliasForVerion(monitorConfig.contractVersion));
      const financialContract = new web3.eth.Contract(
        getVersionedAbi(monitorConfig.contractType),
        financialContractAddress
      );
      const networker = new Networker(logger);

      // We want to enforce that all pricefeeds return prices in the same precision, so we'll construct one price feed
      // initially and grab its precision to pass into the other price feeds:
      const medianizerPriceFeed = await createReferencePriceFeedForFinancialContract(
        logger,
        web3,
        networker,
        getTime,
        financialContractAddress,
        medianizerPriceFeedConfig
      );
      const priceFeedDecimals = medianizerPriceFeed.getPriceFeedDecimals();

      // 0. Setup Financial Contract and token instances to monitor.
      const [tokenPriceFeed, denominatorPriceFeed] = await Promise.all([
        createTokenPriceFeedForFinancialContract(logger, web3, networker, getTime, financialContractAddress, {
          ...tokenPriceFeedConfig,
          priceFeedDecimals,
        }),
        denominatorPriceFeedConfig &&
          createReferencePriceFeedForFinancialContract(logger, web3, networker, getTime, financialContractAddress, {
            ...denominatorPriceFeedConfig,
            priceFeedDecimals,
          }),
      ]);

      // All of the pricefeeds should return prices in the same precision, including the denominator
      // price feed if it exists.
      if (
        medianizerPriceFeed.getPriceFeedDecimals() !== tokenPriceFeed.getPriceFeedDecimals() &&
        denominatorPriceFeed &&
        medianizerPriceFeed.getPriceFeedDecimals() !== denominatorPriceFeed.getPriceFeedDecimals()
      ) {
        throw new Error("Pricefeed decimals are not uniform");
      }

      if (!medianizerPriceFeed || !tokenPriceFeed) {
        throw new Error("Price feed config is invalid");
      }

      const [priceIdentifier, collateralTokenAddress, syntheticTokenAddress] = await Promise.all([
        financialContract.methods.priceIdentifier().call(),
        financialContract.methods.collateralCurrency().call(),
        financialContract.methods.tokenCurrency().call(),
      ]);
      const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), collateralTokenAddress);
      const syntheticToken = new web3.eth.Contract(getAbi("ExpandedERC20"), syntheticTokenAddress);

      const [collateralSymbol, syntheticSymbol, collateralDecimals, syntheticDecimals] = await Promise.all([
        collateralToken.methods.symbol().call(),
        syntheticToken.methods.symbol().call(),
        collateralToken.methods.decimals().call(),
        syntheticToken.methods.decimals().call(),
      ]);
      // Generate Financial Contract properties to inform monitor modules of important info like token symbols and price identifier.
      const financialContractProps = {
        collateralSymbol,
        syntheticSymbol,
        collateralDecimals: Number(collateralDecimals),
        syntheticDecimals: Number(syntheticDecimals),
        priceFeedDecimals,
        priceIdentifier: hexToUtf8(priceIdentifier),
        networkId,
      };

      // 1. Contract state monitor.
      const financialContractEventClient = new FinancialContractEventClient(
        logger,
        getAbi(monitorConfig.contractType, monitorConfig.contractVersion),
        web3,
        financialContractAddress,
        eventsFromBlockNumber,
        endingBlock,
        monitorConfig.contractType
        // TODO: Should use `blocksPerEventSearch` in this event client as well, but this is not added currently as only the
        // Arbitrum Infura provider requires this chunking logic and the FinancialContractEventClient won't be used on
        // Arbitrum initially.
      );

      const contractMonitor = new ContractMonitor({
        logger,
        financialContractEventClient,
        priceFeed: medianizerPriceFeed,
        monitorConfig,
        financialContractProps,
        voting,
      });

      // 2. Balance monitor to inform if monitored addresses drop below critical thresholds.
      const tokenBalanceClient = new TokenBalanceClient(
        logger,
        getAbi("ExpandedERC20"),
        web3,
        collateralTokenAddress,
        syntheticTokenAddress
      );

      const balanceMonitor = new BalanceMonitor({ logger, tokenBalanceClient, monitorConfig, financialContractProps });

      // 3. Collateralization Ratio monitor.
      const financialContractClient = new FinancialContractClient(
        logger,
        getAbi(monitorConfig.contractType, monitorConfig.contractVersion),
        web3,
        financialContractAddress,
        networkName ? multicallAddressMap[networkName].multicall : null,
        collateralDecimals,
        syntheticDecimals,
        medianizerPriceFeed.getPriceFeedDecimals(),
        monitorConfig.contractType
      );

      const crMonitor = new CRMonitor({
        logger,
        financialContractClient,
        priceFeed: medianizerPriceFeed,
        monitorConfig,
        financialContractProps,
      });

      // 4. Synthetic Peg Monitor.
      const syntheticPegMonitor = new SyntheticPegMonitor({
        logger,
        web3,
        uniswapPriceFeed: tokenPriceFeed,
        medianizerPriceFeed,
        denominatorPriceFeed,
        monitorConfig,
        financialContractProps,
        financialContractClient,
      });

      logger.debug({
        at: "Monitor#index",
        message: "Monitor initialized",
        collateralDecimals: Number(collateralDecimals),
        syntheticDecimals: Number(syntheticDecimals),
        priceFeedDecimals: Number(medianizerPriceFeed.getPriceFeedDecimals()),
        tokenPriceFeedConfig,
        medianizerPriceFeedConfig,
        monitorConfig,
      });

      // Clients must be updated before monitors can run:
      populateMonitorRunnerHelpers.push(() => {
        monitorRunners.push(
          Promise.all([
            financialContractClient.update(),
            financialContractEventClient.update(),
            tokenBalanceClient.update(),
            medianizerPriceFeed.update(),
            tokenPriceFeed.update(),
            denominatorPriceFeed && denominatorPriceFeed.update(),
          ]).then(async () => {
            await Promise.all([
              // 1. Contract monitor. Check for liquidations, disputes, dispute settlement and sponsor events.
              contractMonitor.checkForNewLiquidations(),
              contractMonitor.checkForNewDisputeEvents(),
              contractMonitor.checkForNewDisputeSettlementEvents(),
              contractMonitor.checkForNewSponsors(),
              contractMonitor.checkForNewFundingRateUpdatedEvents(),
              // 2.  Wallet Balance monitor. Check if the bot balances have moved past thresholds.
              balanceMonitor.checkBotBalances(),
              // 3.  Position Collateralization Ratio monitor. Check if monitored wallets are still safely above CRs.
              crMonitor.checkWalletCrRatio(),
              // 4. Synthetic peg monitor. Check for peg deviation, peg volatility and synthetic volatility.
              syntheticPegMonitor.checkPriceDeviation(),
              syntheticPegMonitor.checkPegVolatility(),
              syntheticPegMonitor.checkSyntheticVolatility(),
            ]);
          })
        );
      });
    }

    /** *************************************
     *
     * OptimisticOracle Contract Runner
     *
     ***************************************/
    if (optimisticOracleAddress) {
      const optimisticOracleContractEventClient = new OptimisticOracleEventClient(
        logger,
        getAbi(optimisticOracleType),
        web3,
        optimisticOracleAddress,
        optimisticOracleType,
        Number(eventsFromBlockNumber),
        endingBlock ? Number(endingBlock) : null,
        blocksPerEventSearch ? Number(blocksPerEventSearch) : null
      );

      const contractProps = { networkId, chainId };
      const contractMonitor = new OptimisticOracleContractMonitor({
        logger,
        optimisticOracleContractEventClient,
        monitorConfig,
        contractProps,
      });

      // Clients must be updated before monitors can run:
      populateMonitorRunnerHelpers.push(() => {
        monitorRunners.push(
          Promise.all([optimisticOracleContractEventClient.update()]).then(async () => {
            await Promise.all([
              contractMonitor.checkForRequests(),
              contractMonitor.checkForProposals(),
              contractMonitor.checkForDisputes(),
              contractMonitor.checkForSettlements(),
            ]);
          })
        );
      });
    }

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    for (;;) {
      await retry(
        async function () {
          // First populate monitorRunners array with promises to fulfill in parallel:
          populateMonitorRunnerHelpers.forEach((helperFunc) => {
            helperFunc();
          });
          // Now that monitor runners is populated, run them in parallel.
          await Promise.all(monitorRunners);
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
          onRetry: (error) => {
            logger.debug({
              at: "Monitor#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({ at: "Monitor#index", message: "End of serverless execution loop - terminating process" });
        await delay(5); // Set a delay to let the transports flush fully.
        await waitForLogger(logger); // Blocks exiting until the Discord transport is fully flushed.
        break;
      }
      logger.debug({ at: "Monitor#index", message: "End of execution loop - waiting polling delay" });
      await delay(Number(pollingDelay));
    }
  } catch (error) {
    // If any error is thrown, catch it and bubble up to the main try-catch for error processing in the Poll function.
    throw typeof error === "string" ? new Error(error) : error;
  }
}
async function Poll(callback) {
  try {
    if (!process.env.OPTIMISTIC_ORACLE_ADDRESS && !process.env.EMP_ADDRESS && !process.env.FINANCIAL_CONTRACT_ADDRESS) {
      throw new Error(
        "Bad environment variables! Specify an OPTIMISTIC_ORACLE_ADDRESS, EMP_ADDRESS or FINANCIAL_CONTRACT_ADDRESS for the location of the contract the bot is expected to interact with."
      );
    }

    // Deprecate UNISWAP_PRICE_FEED_CONFIG to favor TOKEN_PRICE_FEED_CONFIG, leaving in for compatibility.
    // If nothing defined, it will default to uniswap within createPriceFeed
    const tokenPriceFeedConfigEnv = process.env.TOKEN_PRICE_FEED_CONFIG || process.env.UNISWAP_PRICE_FEED_CONFIG;
    const denominatorPriceFeedConfigEnv = process.env.TOKEN_DENOMINATOR_PRICE_FEED_CONFIG;

    // This object is spread when calling the `run` function below. It relies on the object enumeration order and must
    // match the order of parameters defined in the`run` function.
    const executionParameters = {
      optimisticOracleAddress: process.env.OPTIMISTIC_ORACLE_ADDRESS,
      // Type of "OptimisticOracle" to load in client, default is OptimisticOracle. The other possible types are
      // exported in an enum from financial-templates-lib/OptimisticOracleClient.
      optimisticOracleType: process.env.OPTIMISTIC_ORACLE_TYPE
        ? process.env.OPTIMISTIC_ORACLE_TYPE
        : OptimisticOracleType.OptimisticOracle,
      financialContractAddress: process.env.EMP_ADDRESS || process.env.FINANCIAL_CONTRACT_ADDRESS,
      // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
      // Default to 3 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 3,
      // Default to 1 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES_TIMEOUT ? Number(process.env.ERROR_RETRIES_TIMEOUT) : 1,
      // Block number to search for events from. If set, acts to offset the search to ignore events in the past. If not
      // set then default to null which indicates that the bot should start at the current block number.
      startingBlock: process.env.STARTING_BLOCK_NUMBER,
      // Block number to search for events to. If set, acts to limit from where the monitor bot will search for events up
      // until. If not set the default to null which indicates that the bot should search up to 'latest'.
      endingBlock: process.env.ENDING_BLOCK_NUMBER,
      // Amount of blocks to search per web3 request to fetch events. This can be used with providers that limit the
      // amount of blocks that can be fetched per request, including Arbitrum Infura nodes. Defaults to null which
      // searches the maximum amount of blocks.
      blocksPerEventSearch: process.env.MAX_BLOCKS_PER_EVENT_SEARCH,
      // Monitor config contains all configuration settings for all monitor modules. This includes the following:
      // MONITOR_CONFIG={
      //  "botsToMonitor": [{ name: "Liquidator Bot",       // Friendly bot name
      //     address: "0x12345"                             // Bot address
      //    "collateralThreshold": "500000000000000000000", // 500e18 collateral token currency.
      //    "syntheticThreshold": "2000000000000000000000", // 200e18 synthetic token currency.
      //    "etherThreshold": "500000000000000000" },       // 0.5e18 Wei alert
      //  ...],
      //  "walletsToMonitor": [{ name: "Market Making bot", // Friendly bot name
      //    address: "0x12345",                             // bot address
      //    crAlert: 1.50 },                                // CR monitoring threshold. 1.5=150%
      //  ...],
      //  "monitoredLiquidators": ["0x1234","0x5678"],       // Array of liquidator bots of interest.
      //  "monitoredDisputers": ["0x1234","0x5678"],         // Array of disputer bots of interest.
      //  "deviationAlertThreshold": 0.5,                    // If deviation in token price exceeds this fire alert.
      //  "volatilityWindow": 600,                           // Length of time (in seconds) to snapshot volatility.
      //  "pegVolatilityAlertThreshold": 0.1,                // Threshold for synthetic peg (identifier) price volatility over `volatilityWindow`.
      //  "syntheticVolatilityAlertThreshold": 0.1,          // Threshold for synthetic token on uniswap price volatility over `volatilityWindow`.
      //  "logOverrides":{                                   // override specific events log levels.
      //       "deviation":"error",                          // SyntheticPegMonitor deviation alert.
      //       "crThreshold":"error",                        // CRMonitor CR threshold alert.
      //       "syntheticThreshold":"error",                 // BalanceMonitor synthetic balance threshold alert.
      //       "collateralThreshold":"error",                // BalanceMonitor collateral balance threshold alert.
      //       "ethThreshold":"error",                       // BalanceMonitor ETH balance threshold alert.
      //       "newPositionCreated":"debug"                  // ContractMonitor new position created.
      //       "proposedPrice":"info"                        // OptimisticOracleContractMonitor price proposed
      //       "disputedPrice":"info"                        // OptimisticOracleContractMonitor price disputed
      //       "settledPrice":"warn"                         // OptimisticOracleContractMonitor price settled
      //       "requestedPrice":"info"                       // OptimisticOracleContractMonitor price requested
      //   },
      //  "optimisticOracleUIBaseUrl": "https://example.com/" // This is the base URL for the Optimistic Oracle UI.
      // }
      monitorConfig: process.env.MONITOR_CONFIG ? JSON.parse(process.env.MONITOR_CONFIG) : {},
      // Read price feed configuration from an environment variable. Uniswap price feed contains information about the
      // uniswap market. EG: {"type":"uniswap","twapLength":2,"lookback":7200,"invertPrice":true "uniswapAddress":"0x1234"}
      // Requires the address of the balancer pool where price is available.
      // Balancer market. EG: {"type":"balancer", "balancerAddress":"0x1234"}
      tokenPriceFeedConfig: tokenPriceFeedConfigEnv ? JSON.parse(tokenPriceFeedConfigEnv) : null,
      // Medianizer price feed averages over a set of different sources to get an average. Config defines the exchanges
      // to use. EG: {"type":"medianizer","pair":"ethbtc", "invertPrice":true, "lookback":7200,"minTimeBetweenUpdates":60,"medianizedFeeds":[
      // {"type":"cryptowatch","exchange":"coinbase-pro"},{"type":"cryptowatch","exchange":"binance"}]}
      denominatorPriceFeedConfig: denominatorPriceFeedConfigEnv ? JSON.parse(denominatorPriceFeedConfigEnv) : null,
      medianizerPriceFeedConfig: process.env.MEDIANIZER_PRICE_FEED_CONFIG
        ? JSON.parse(process.env.MEDIANIZER_PRICE_FEED_CONFIG)
        : null,
    };

    await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "Monitor#index",
      message: "Monitor execution error🚨",
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
