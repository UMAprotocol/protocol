require("dotenv").config();
const retry = require("async-retry");

const { hexToUtf8 } = web3.utils;

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
} = require("@umaprotocol/financial-templates-lib");

// Monitor modules to report on client state changes.
const { ContractMonitor } = require("./src/ContractMonitor");
const { BalanceMonitor } = require("./src/BalanceMonitor");
const { CRMonitor } = require("./src/CRMonitor");
const { SyntheticPegMonitor } = require("./src/SyntheticPegMonitor");

// Truffle contracts artifacts.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const Voting = artifacts.require("Voting");

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
async function run(
  logger,
  address,
  pollingDelay,
  errorRetries,
  errorRetriesTimeout,
  startingBlock,
  endingBlock,
  monitorConfig,
  tokenPriceFeedConfig,
  medianizerPriceFeedConfig
) {
  try {
    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "Monitor#index",
      message: "Monitor started 🕵️‍♂️",
      empAddress: address,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      startingBlock,
      endingBlock,
      monitorConfig,
      tokenPriceFeedConfig,
      medianizerPriceFeedConfig
    });

    // 0. Setup EMP and token instances to monitor.
    const emp = await ExpiringMultiParty.at(address);
    const collateralTokenAddress = await emp.collateralCurrency();
    const collateralToken = await ExpandedERC20.at(collateralTokenAddress);
    const syntheticTokenAddress = await emp.tokenCurrency();
    const syntheticToken = await ExpandedERC20.at(syntheticTokenAddress);
    const votingContract = await Voting.deployed();

    // Generate EMP properties to inform monitor modules of important info like token symbols and price identifier.
    const empProps = {
      collateralCurrencySymbol: await collateralToken.symbol(),
      syntheticCurrencySymbol: await syntheticToken.symbol(),
      priceIdentifier: hexToUtf8(await emp.priceIdentifier()),
      networkId: await web3.eth.net.getId()
    };

    // Setup medianizer price feed.
    const getTime = () => Math.round(new Date().getTime() / 1000);
    const medianizerPriceFeed = await createReferencePriceFeedForEmp(
      logger,
      web3,
      new Networker(logger),
      getTime,
      address,
      medianizerPriceFeedConfig
    );

    // 1. Contract state monitor.
    // Start the event client by looking from the provided `startingBlock` number to the provided `endingBlock` number.
    // If param are sets to null then use the `latest` block number for the `eventsFromBlockNumber` and leave the
    // `endingBlock` as null in the client constructor. The client will then query up until the `latest` block on every
    // loop and update this variable accordingly on each iteration.
    const eventsFromBlockNumber = startingBlock ? startingBlock : (await web3.eth.getBlock("latest")).number;

    const empEventClient = new ExpiringMultiPartyEventClient(
      logger,
      ExpiringMultiParty.abi,
      web3,
      emp.address,
      eventsFromBlockNumber,
      endingBlock
    );

    const contractMonitor = new ContractMonitor(
      logger,
      empEventClient,
      medianizerPriceFeed,
      monitorConfig,
      empProps,
      votingContract
    );

    // 2. Balance monitor to inform if monitored addresses drop below critical thresholds.
    const tokenBalanceClient = new TokenBalanceClient(
      logger,
      ExpandedERC20.abi,
      web3,
      collateralTokenAddress,
      syntheticTokenAddress
    );

    const balanceMonitor = new BalanceMonitor(logger, tokenBalanceClient, monitorConfig, empProps);

    // 3. Collateralization Ratio monitor.
    const empClient = new ExpiringMultiPartyClient(logger, ExpiringMultiParty.abi, web3, emp.address);

    const crMonitor = new CRMonitor(logger, empClient, medianizerPriceFeed, monitorConfig, empProps);

    // 4. Synthetic Peg Monitor.
    const tokenPriceFeed = await createTokenPriceFeedForEmp(
      logger,
      web3,
      new Networker(logger),
      getTime,
      address,
      tokenPriceFeedConfig
    );
    const syntheticPegMonitor = new SyntheticPegMonitor(
      logger,
      web3,
      tokenPriceFeed,
      medianizerPriceFeed,
      monitorConfig,
      empProps
    );

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    while (true) {
      await retry(
        async () => {
          // 1.  Contract monitor
          // 1.a Update the client
          await empEventClient.update();
          await medianizerPriceFeed.update();
          // 1.b Check For new liquidation events
          await contractMonitor.checkForNewLiquidations();
          // 1.c Check for new disputes
          await contractMonitor.checkForNewDisputeEvents();
          // 1.d Check for new disputeSettlements
          await contractMonitor.checkForNewDisputeSettlementEvents();
          // 1.e Check for new sponsor positions created
          await contractMonitor.checkForNewSponsors();

          // 2.  Wallet Balance monitor
          // 2.a Update the client
          await tokenBalanceClient.update();
          // 2.b Check for monitored bot balance changes
          await balanceMonitor.checkBotBalances();

          // 3.  Position Collateralization Ratio monitor
          // 3.a Update the client
          await empClient.update();
          // 3.b Check for positions below their CR
          await crMonitor.checkWalletCrRatio();

          // 4. Synthetic peg monitor
          // 4.a Update the price feeds
          await tokenPriceFeed.update();
          await medianizerPriceFeed.update();
          // 4.b Check for synthetic peg deviation
          await syntheticPegMonitor.checkPriceDeviation();
          // 4.c Check for price feed volatility
          await syntheticPegMonitor.checkPegVolatility();
          await syntheticPegMonitor.checkSyntheticVolatility();
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
    logger.error({
      at: "Monitor#index",
      message: "Monitor polling error. Monitor crashed🚨",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(logger);
  }
}
async function Poll(callback) {
  try {
    if (!process.env.EMP_ADDRESS) {
      throw new Error(
        "Bad environment variables! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party."
      );
    }

    // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
    const pollingDelay = process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60;

    // Default to 5 re-tries on error within the execution loop.
    const errorRetries = process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 5;

    // Default to 10 seconds in between error re-tries.
    const errorRetriesTimeout = process.env.ERROR_RETRIES__TIMEOUT ? Number(process.env.ERROR_RETRIES__TIMEOUT) : 10;

    // Block number to search for events from. If set, acts to offset the search to ignore events in the past. If not
    // set then default to null which indicates that the bot should start at the current block number.
    const startingBlock = process.env.STARTING_BLOCK_NUMBER;

    // Block number to search for events to. If set, acts to limit from where the monitor bot will search for events up
    // until. If not set the default to null which indicates that the bot should search up to 'latest'.
    const endingBlock = process.env.ENDING_BLOCK_NUMBER;

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
    //       "syntheticThreshold":"error",                 // BalanceMonitor synthetic balance threshold alert.
    //       "crThreshold":"error",                        // CRMonitor CR threshold alert.
    //       "collateralThreshold":"error",                // BalanceMonitor collateral balance threshold alert.
    //       "ethThreshold":"error",                       // BalanceMonitor ETH balance threshold alert.
    //   }
    // }
    const monitorConfig = process.env.MONITOR_CONFIG ? JSON.parse(process.env.MONITOR_CONFIG) : null;

    // Deprecate UNISWAP_PRICE_FEED_CONFIG to favor TOKEN_PRICE_FEED_CONFIG, leaving in for compatibility.
    // If nothing defined, it will default to uniswap within createPriceFeed
    const tokenPriceFeedConfigEnv = process.env.TOKEN_PRICE_FEED_CONFIG || process.env.UNISWAP_PRICE_FEED_CONFIG;

    // Read price feed configuration from an environment variable. Uniswap price feed contains information about the
    // uniswap market. EG: {"type":"uniswap","twapLength":2,"lookback":7200,"invertPrice":true "uniswapAddress":"0x1234"}
    // Requires the address of the balancer pool where price is available.
    // Balancer market. EG: {"type":"balancer", "balancerAddress":"0x1234"}
    const tokenPriceFeedConfig = tokenPriceFeedConfigEnv ? JSON.parse(tokenPriceFeedConfigEnv) : null;

    // Medianizer price feed averages over a set of different sources to get an average. Config defines the exchanges
    // to use. EG: {"type":"medianizer","pair":"ethbtc", "invertPrice":true, "lookback":7200,"minTimeBetweenUpdates":60,"medianizedFeeds":[
    // {"type":"cryptowatch","exchange":"coinbase-pro"},{"type":"cryptowatch","exchange":"binance"}]}
    const medianizerPriceFeedConfig = process.env.MEDIANIZER_PRICE_FEED_CONFIG
      ? JSON.parse(process.env.MEDIANIZER_PRICE_FEED_CONFIG)
      : null;

    await run(
      Logger,
      process.env.EMP_ADDRESS,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      startingBlock,
      endingBlock,
      monitorConfig,
      tokenPriceFeedConfig,
      medianizerPriceFeedConfig
    );
  } catch (error) {
    Logger.error({
      at: "Monitor#index",
      message: "Monitor configuration error🚨",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(Logger);
    callback(error);
    return;
  }
  callback();
}

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
