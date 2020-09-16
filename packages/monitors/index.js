#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

// Clients to retrieve on-chain data and helpers.
const {
  ExpiringMultiPartyClient,
  ExpiringMultiPartyEventClient,
  TokenBalanceClient,
  Networker,
  Logger,
  createReferencePriceFeedForEmp,
  createTokenPriceFeedForEmp,
  waitForLogger,
  delay
} = require("@uma/financial-templates-lib");

// Monitor modules to report on client state changes.
const { ContractMonitor } = require("./src/ContractMonitor");
const { BalanceMonitor } = require("./src/BalanceMonitor");
const { CRMonitor } = require("./src/CRMonitor");
const { SyntheticPegMonitor } = require("./src/SyntheticPegMonitor");

// Contract ABIs and network Addresses.
const { getAbi, getAddress } = require("@uma/core");
const { getWeb3 } = require("@uma/common");

/**
 * @notice Continuously attempts to monitor contract positions and reports based on monitor modules.
 * @param {Object} logger Module responsible for sending logs.
 * @param {String} address Contract address of the EMP.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Number} errorRetries The number of times the execution loop will re-try before throwing if an error occurs.
 * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
 * @param {Number} startingBlock Offset block number to define where the monitor bot should start searching for events
 *     from. If 0 will look for all events back to deployment of the EMP. If set to null uses current block number.
 * @param {Number} endingBlock Termination block number to define where the monitor bot should end searching for events.
 *     If `null` then will search up until the latest block number in each loop.
 * @param {Object} monitorConfig Configuration object to parameterize all monitor modules.
 * @param {Object} tokenPriceFeedConfig Configuration to construct the tokenPriceFeed (balancer or uniswap) price feed object.
 * @param {Object} medianizerPriceFeedConfig Configuration to construct the reference price feed object.
 * @return None or throws an Error.
 */
async function run({
  logger,
  web3,
  empAddress,
  pollingDelay,
  errorRetries,
  errorRetriesTimeout,
  startingBlock,
  endingBlock,
  monitorConfig,
  tokenPriceFeedConfig,
  medianizerPriceFeedConfig
}) {
  try {
    const { hexToUtf8 } = web3.utils;

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "Monitor#index",
      message: "Monitor started 🕵️‍♂️",
      empAddress,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      startingBlock,
      endingBlock,
      monitorConfig,
      tokenPriceFeedConfig,
      medianizerPriceFeedConfig
    });

    const getTime = () => Math.round(new Date().getTime() / 1000);

    const networker = new Networker(logger);

    // 0. Setup EMP and token instances to monitor.
    const [networkId, latestBlock, medianizerPriceFeed, tokenPriceFeed] = await Promise.all([
      web3.eth.net.getId(),
      web3.eth.getBlock("latest"),
      createReferencePriceFeedForEmp(logger, web3, networker, getTime, empAddress, medianizerPriceFeedConfig),
      createTokenPriceFeedForEmp(logger, web3, networker, getTime, empAddress, tokenPriceFeedConfig)
    ]);

    if (!medianizerPriceFeed || !tokenPriceFeed) {
      throw new Error("Price feed config is invalid");
    }

    // Setup contract instances. NOTE that getAddress("Voting", networkId) will resolve to null in tests.
    const emp = new web3.eth.Contract(getAbi("ExpiringMultiParty"), empAddress);
    const voting = new web3.eth.Contract(getAbi("Voting"), getAddress("Voting", networkId));

    const [priceIdentifier, collateralTokenAddress, syntheticTokenAddress] = await Promise.all([
      emp.methods.priceIdentifier().call(),
      emp.methods.collateralCurrency().call(),
      emp.methods.tokenCurrency().call()
    ]);

    const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), collateralTokenAddress);
    const syntheticToken = new web3.eth.Contract(getAbi("ExpandedERC20"), syntheticTokenAddress);

    const [
      collateralCurrencySymbol,
      syntheticCurrencySymbol,
      collateralCurrencyDecimals,
      syntheticCurrencyDecimals
    ] = await Promise.all([
      collateralToken.methods.symbol().call(),
      syntheticToken.methods.symbol().call(),
      collateralToken.methods.decimals().call(),
      syntheticToken.methods.decimals().call()
    ]);

    // Generate EMP properties to inform monitor modules of important info like token symbols and price identifier.
    const empProps = {
      collateralCurrencySymbol,
      syntheticCurrencySymbol,
      collateralCurrencyDecimals,
      syntheticCurrencyDecimals,
      priceIdentifier: hexToUtf8(priceIdentifier),
      networkId
    };

    // 1. Contract state monitor.
    // Start the event client by looking from the provided `startingBlock` number to the provided `endingBlock` number.
    // If param are sets to null then use the `latest` block number for the `eventsFromBlockNumber` and leave the
    // `endingBlock` as null in the client constructor. The client will then query up until the `latest` block on every
    // loop and update this variable accordingly on each iteration.
    const eventsFromBlockNumber = startingBlock ? startingBlock : latestBlock.number;

    const empEventClient = new ExpiringMultiPartyEventClient(
      logger,
      getAbi("ExpiringMultiParty"),
      web3,
      empAddress,
      eventsFromBlockNumber,
      endingBlock
    );

    const contractMonitor = new ContractMonitor({
      logger,
      expiringMultiPartyEventClient: empEventClient,
      priceFeed: medianizerPriceFeed,
      config: monitorConfig,
      empProps,
      voting
    });

    // 2. Balance monitor to inform if monitored addresses drop below critical thresholds.
    const tokenBalanceClient = new TokenBalanceClient(
      logger,
      getAbi("ExpandedERC20"),
      web3,
      collateralTokenAddress,
      syntheticTokenAddress
    );

    const balanceMonitor = new BalanceMonitor({
      logger,
      tokenBalanceClient,
      config: monitorConfig,
      empProps
    });

    // 3. Collateralization Ratio monitor.
    const empClient = new ExpiringMultiPartyClient(logger, getAbi("ExpiringMultiParty"), web3, empAddress);

    const crMonitor = new CRMonitor({
      logger,
      expiringMultiPartyClient: empClient,
      priceFeed: medianizerPriceFeed,
      config: monitorConfig,
      empProps
    });

    // 4. Synthetic Peg Monitor.
    const syntheticPegMonitor = new SyntheticPegMonitor({
      logger,
      web3,
      uniswapPriceFeed: tokenPriceFeed,
      medianizerPriceFeed,
      config: monitorConfig,
      empProps
    });

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    while (true) {
      await retry(
        async () => {
          // Update all client and price feeds.
          await Promise.all([
            empClient.update(),
            empEventClient.update(),
            tokenBalanceClient.update(),
            medianizerPriceFeed.update(),
            tokenPriceFeed.update()
          ]);

          // Run all queries within the monitor bots modules.
          await Promise.all([
            // 1. Contract monitor. Check for liquidations, disputes, dispute settlement and sponsor events.
            contractMonitor.checkForNewLiquidations(),
            contractMonitor.checkForNewDisputeEvents(),
            contractMonitor.checkForNewDisputeSettlementEvents(),
            contractMonitor.checkForNewSponsors(),
            // 2.  Wallet Balance monitor. Check if the bot ballances have moved past thresholds.
            balanceMonitor.checkBotBalances(),
            // 3.  Position Collateralization Ratio monitor. Check if monitored wallets are still safely above CRs.
            crMonitor.checkWalletCrRatio(),
            // 4. Synthetic peg monitor. Check for peg deviation, peg volatility and synthetic volatility.
            syntheticPegMonitor.checkPriceDeviation(),
            syntheticPegMonitor.checkPegVolatility(),
            syntheticPegMonitor.checkSyntheticVolatility()
          ]);
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
          onRetry: error => {
            logger.debug({
              at: "Monitor#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error
            });
          }
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: "Monitor#index",
          message: "End of serverless execution loop - terminating process"
        });
        await waitForLogger(logger);
        break;
      }
      logger.debug({
        at: "Monitor#index",
        message: "End of execution loop - waiting polling delay"
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
    if (!process.env.EMP_ADDRESS) {
      throw new Error(
        "Bad environment variables! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party."
      );
    }

    // Deprecate UNISWAP_PRICE_FEED_CONFIG to favor TOKEN_PRICE_FEED_CONFIG, leaving in for compatibility.
    // If nothing defined, it will default to uniswap within createPriceFeed
    const tokenPriceFeedConfigEnv = process.env.TOKEN_PRICE_FEED_CONFIG || process.env.UNISWAP_PRICE_FEED_CONFIG;

    // This object is spread when calling the `run` function below. It relies on the object enumeration order and must
    // match the order of parameters defined in the`run` function.
    const executionParameters = {
      empAddress: process.env.EMP_ADDRESS,
      // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
      // Default to 5 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 5,
      // Default to 10 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES__TIMEOUT ? Number(process.env.ERROR_RETRIES__TIMEOUT) : 10,
      // Block number to search for events from. If set, acts to offset the search to ignore events in the past. If not
      // set then default to null which indicates that the bot should start at the current block number.
      startingBlock: process.env.STARTING_BLOCK_NUMBER,
      // Block number to search for events to. If set, acts to limit from where the monitor bot will search for events up
      // until. If not set the default to null which indicates that the bot should search up to 'latest'.
      endingBlock: process.env.ENDING_BLOCK_NUMBER,
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
      //   }
      // }
      monitorConfig: process.env.MONITOR_CONFIG ? JSON.parse(process.env.MONITOR_CONFIG) : null,
      // Read price feed configuration from an environment variable. Uniswap price feed contains information about the
      // uniswap market. EG: {"type":"uniswap","twapLength":2,"lookback":7200,"invertPrice":true "uniswapAddress":"0x1234"}
      // Requires the address of the balancer pool where price is available.
      // Balancer market. EG: {"type":"balancer", "balancerAddress":"0x1234"}
      tokenPriceFeedConfig: tokenPriceFeedConfigEnv ? JSON.parse(tokenPriceFeedConfigEnv) : null,
      // Medianizer price feed averages over a set of different sources to get an average. Config defines the exchanges
      // to use. EG: {"type":"medianizer","pair":"ethbtc", "invertPrice":true, "lookback":7200,"minTimeBetweenUpdates":60,"medianizedFeeds":[
      // {"type":"cryptowatch","exchange":"coinbase-pro"},{"type":"cryptowatch","exchange":"binance"}]}
      medianizerPriceFeedConfig: process.env.MEDIANIZER_PRICE_FEED_CONFIG
        ? JSON.parse(process.env.MEDIANIZER_PRICE_FEED_CONFIG)
        : null
    };

    await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "Monitor#index",
      message: "Monitor execution error🚨",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(Logger);
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
