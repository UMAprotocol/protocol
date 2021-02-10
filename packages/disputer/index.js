#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

// Helpers
const { MAX_UINT_VAL, findContractVersion, SUPPORTED_CONTRACT_VERSIONS } = require("@uma/common");

// JS libs
const { Disputer } = require("./src/disputer");
const {
  FinancialContractClient,
  GasEstimator,
  Logger,
  Networker,
  delay,
  waitForLogger,
  createReferencePriceFeedForFinancialContract
} = require("@uma/financial-templates-lib");

// Truffle contracts.
const { getAbi, getAddress } = require("@uma/core");
const { getWeb3 } = require("@uma/common");

/**
 * @notice Continuously attempts to dispute liquidations in the Financial Contract contract.
 * @param {Object} logger Module responsible for sending logs.
 * @param {String} address Contract address of the Financial Contract.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Object} priceFeedConfig Configuration to construct the price feed object.
 * @param {Object} [disputerConfig] Configuration to construct the disputer.
 * @param {String} [disputerOverridePrice] Optional String representing a Wei number to override the disputer price feed.
 * @return None or throws an Error.
 */
async function run({
  logger,
  web3,
  financialContractAddress,
  pollingDelay,
  errorRetries,
  errorRetriesTimeout,
  priceFeedConfig,
  disputerConfig,
  disputerOverridePrice
}) {
  try {
    const { toBN } = web3.utils;
    const getTime = () => Math.round(new Date().getTime() / 1000);

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "Disputer#index",
      message: "Disputer started🔎",
      financialContractAddress,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      priceFeedConfig,
      disputerConfig,
      disputerOverridePrice
    });

    // Load unlocked web3 accounts and get the networkId.
    const [detectedContract, accounts, networkId] = await Promise.all([
      findContractVersion(financialContractAddress, web3),
      web3.eth.getAccounts(),
      web3.eth.net.getId()
    ]);

    // Append the contract version and type to the disputerConfig, if the disputerConfig does not already contain one.
    if (!disputerConfig) disputerConfig = {};
    if (!disputerConfig.contractVersion) disputerConfig.contractVersion = detectedContract.contractVersion;
    if (!disputerConfig.contractType) disputerConfig.contractType = detectedContract.contractType;

    // Check that the version and type is supported. Note if either is null this check will also catch it.
    if (
      SUPPORTED_CONTRACT_VERSIONS.filter(
        vo => vo.contractType == disputerConfig.contractType && vo.contractVersion == disputerConfig.contractVersion
      ).length == 0
    )
      throw new Error(
        `Contract version specified or inferred is not supported by this bot. Disputer config:${JSON.stringify(
          disputerConfig
        )} & detectedContractVersion:${JSON.stringify(detectedContract)} are not part of ${JSON.stringify(
          SUPPORTED_CONTRACT_VERSIONS
        )}`
      );

    // Setup contract instances.
    const voting = new web3.eth.Contract(getAbi("Voting", "1.2.2"), getAddress("Voting", networkId));
    const financialContract = new web3.eth.Contract(
      getAbi(disputerConfig.contractType, disputerConfig.contractVersion),
      financialContractAddress
    );

    // Generate Financial Contract properties to inform bot of important on-chain state values that we only want to query once.
    const [collateralTokenAddress, syntheticTokenAddress] = await Promise.all([
      financialContract.methods.collateralCurrency().call(),
      financialContract.methods.tokenCurrency().call()
    ]);

    const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), collateralTokenAddress);
    const syntheticToken = new web3.eth.Contract(getAbi("ExpandedERC20"), syntheticTokenAddress);
    const [priceIdentifier, currentAllowance, collateralDecimals, syntheticDecimals] = await Promise.all([
      financialContract.methods.priceIdentifier().call(),
      collateralToken.methods.allowance(accounts[0], financialContractAddress).call(),
      collateralToken.methods.decimals().call(),
      syntheticToken.methods.decimals().call()
    ]);

    const priceFeed = await createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      new Networker(logger),
      getTime,
      financialContractAddress,
      priceFeedConfig
    );

    if (!priceFeed) {
      throw new Error("Price feed config is invalid");
    }

    // Generate Financial Contract properties to inform bot of important on-chain state values that we only want to query once.
    const financialContractProps = {
      priceIdentifier: priceIdentifier
    };

    // Client and dispute bot.
    const financialContractClient = new FinancialContractClient(
      logger,
      getAbi(disputerConfig.contractType, disputerConfig.contractVersion),
      web3,
      financialContractAddress,
      collateralDecimals,
      syntheticDecimals,
      priceFeed.getPriceFeedDecimals(),
      disputerConfig.contractType
    );

    const gasEstimator = new GasEstimator(logger);
    const disputer = new Disputer({
      logger,
      financialContractClient,
      votingContract: voting,
      gasEstimator,
      priceFeed,
      account: accounts[0],
      financialContractProps,
      disputerConfig
    });

    logger.debug({
      at: "Disputer#index",
      message: "Disputer initialized",
      collateralDecimals: Number(collateralDecimals),
      syntheticDecimals: Number(syntheticDecimals),
      priceFeedDecimals: Number(priceFeed.getPriceFeedDecimals()),
      priceFeedConfig,
      disputerConfig
    });

    // The Financial Contract requires approval to transfer the disputer's collateral tokens in order to dispute a liquidation.
    // We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
    if (toBN(currentAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      await gasEstimator.update();
      const collateralApprovalTx = await collateralToken.methods.approve(financialContractAddress, MAX_UINT_VAL).send({
        from: accounts[0],
        gasPrice: gasEstimator.getCurrentFastPrice()
      });
      logger.info({
        at: "Disputer#index",
        message: "Approved Financial Contract to transfer unlimited collateral tokens 💰",
        collateralApprovalTx: collateralApprovalTx.transactionHash
      });
    }

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    for (;;) {
      await retry(
        async () => {
          await disputer.update();
          await disputer.dispute(disputerOverridePrice);
          await disputer.withdrawRewards();
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000,
          randomize: false,
          onRetry: error => {
            logger.debug({
              at: "Disputer#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error
            });
          }
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: "Disputer#index",
          message: "End of serverless execution loop - terminating process"
        });
        await waitForLogger(logger);
        await delay(2); // waitForLogger does not always work 100% correctly in serverless. add a delay to ensure logs are captured upstream.
        break;
      }
      logger.debug({
        at: "Disputer#index",
        message: "End of execution loop - waiting polling delay",
        pollingDelay: `${pollingDelay} (s)`
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
    if (!process.env.EMP_ADDRESS && !process.env.FINANCIAL_CONTRACT_ADDRESS) {
      throw new Error(
        "Bad environment variables! Specify an EMP_ADDRESS or FINANCIAL_CONTRACT_ADDRESS for the location of the financial contract the bot is expected to interact with."
      );
    }

    // This object is spread when calling the `run` function below. It relies on the object enumeration order and must
    // match the order of parameters defined in the`run` function.
    const executionParameters = {
      financialContractAddress: process.env.EMP_ADDRESS || process.env.FINANCIAL_CONTRACT_ADDRESS,
      // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
      // Default to 3 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 3,
      // Default to 1 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES__TIMEOUT ? Number(process.env.ERROR_RETRIES__TIMEOUT) : 1,
      // Read price feed configuration from an environment variable. This can be a crypto watch, medianizer or uniswap
      // price feed Config defines the exchanges to use. If not provided then the bot will try and infer a price feed
      // from the EMP_ADDRESS. EG with medianizer: {"type":"medianizer","pair":"ethbtc",
      // "lookback":7200, "minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"},
      // {"type":"cryptowatch","exchange":"binance"}]}
      priceFeedConfig: process.env.PRICE_FEED_CONFIG ? JSON.parse(process.env.PRICE_FEED_CONFIG) : null,
      // If there is a disputer config, add it. Else, set to null. This config contains disputeDelay and txnGasLimit. EG:
      // {"disputeDelay":60, -> delay in seconds from detecting a disputable position to actually sending the dispute.
      // "txnGasLimit":9000000 -> gas limit for sent transactions.
      // "contractType":"ExpiringMultiParty", -> override the kind of contract the disputer is pointing at.
      // "contractVersion":"ExpiringMultiParty"} -> override the contract version the disputer is pointing at.
      // }
      disputerConfig: process.env.DISPUTER_CONFIG ? JSON.parse(process.env.DISPUTER_CONFIG) : null,
      // If there is a DISPUTER_OVERRIDE_PRICE environment variable then the disputer will disregard the price from the
      // price feed and preform disputes at this override price. Use with caution as wrong input could cause invalid disputes.
      disputerOverridePrice: process.env.DISPUTER_OVERRIDE_PRICE
    };

    await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "Disputer#index",
      message: "Disputer execution error🚨",
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
