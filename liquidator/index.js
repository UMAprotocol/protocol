require("dotenv").config();

// Helpers
const { MAX_UINT_VAL } = require("@umaprotocol/common");
const { toBN } = web3.utils;

// JS libs
const { Liquidator } = require("./src/liquidator");
const {
  GasEstimator,
  ExpiringMultiPartyClient,
  Networker,
  createReferencePriceFeedForEmp,
  waitForLogger,
  delay
} = require("@umaprotocol/financial-templates-lib");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const Voting = artifacts.require("Voting");

// App modules
const SETTINGS = require("./src/settings");
const { getTime, getLogger } = require("./src/common");

const { EMP_ADDRESS, POLLING_DELAY, LIQUIDATOR_CONFIG, LIQUIDATOR_OVERRIDE_PRICE, PRICE_FEED_CONFIG } = SETTINGS;

/**
 * @notice Continuously attempts to liquidate positions in the EMP contract.
 */
async function run({
  logger = getLogger(),
  empAddress = EMP_ADDRESS,
  pollingDelay = POLLING_DELAY,
  liquidatorConfig = LIQUIDATOR_CONFIG,
  liquidatorOverridePrice = LIQUIDATOR_OVERRIDE_PRICE,
  priceFeedConfig = PRICE_FEED_CONFIG
}) {
  try {
    if (!empAddress) {
      throw new Error(
        "Bad input arg! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party within your environment variables."
      );
    }

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "Liquidator#index",
      message: "Liquidator started 🌊",
      ...SETTINGS
    });

    // Setup web3 accounts an contract instance.
    const accounts = await web3.eth.getAccounts();
    const emp = await ExpiringMultiParty.at(empAddress);
    const voting = await Voting.deployed();

    // Generate EMP properties to inform bot of important on-chain state values that we only want to query once.
    const empProps = {
      crRatio: await emp.collateralRequirement(),
      priceIdentifier: await emp.priceIdentifier(),
      minSponsorSize: await emp.minSponsorTokens()
    };

    // Setup price feed.
    const priceFeed = await createReferencePriceFeedForEmp(
      logger,
      web3,
      new Networker(logger),
      getTime,
      empAddress,
      priceFeedConfig
    );

    if (!priceFeedConfig) {
      throw new Error("Price feed config is invalid");
    }

    // Client and liquidator bot
    const empClient = new ExpiringMultiPartyClient(logger, ExpiringMultiParty.abi, web3, emp.address);
    const gasEstimator = new GasEstimator(logger);
    const liquidator = new Liquidator({
      logger,
      expiringMultiPartyClient: empClient,
      votingContract: voting,
      gasEstimator,
      priceFeed,
      account: accounts[0],
      empProps,
      config: liquidatorConfig
    });

    // The EMP requires approval to transfer the liquidator's collateral and synthetic tokens in order to liquidate
    // a position. We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
    await gasEstimator.update();
    const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
    const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());
    const currentCollateralAllowance = await collateralToken.allowance(accounts[0], empClient.empAddress);
    const currentSyntheticAllowance = await syntheticToken.allowance(accounts[0], empClient.empAddress);
    if (toBN(currentCollateralAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      const collateralApprovalTx = await collateralToken.approve(empClient.empAddress, MAX_UINT_VAL, {
        from: accounts[0],
        gasPrice: gasEstimator.getCurrentFastPrice()
      });
      logger.info({
        at: "Liquidator#index",
        message: "Approved EMP to transfer unlimited collateral tokens 💰",
        collateralApprovalTx: collateralApprovalTx.tx
      });
    }
    if (toBN(currentSyntheticAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      const syntheticApprovalTx = await syntheticToken.approve(empClient.empAddress, MAX_UINT_VAL, {
        from: accounts[0],
        gasPrice: gasEstimator.getCurrentFastPrice()
      });
      logger.info({
        at: "Liquidator#index",
        message: "Approved EMP to transfer unlimited synthetic tokens 💰",
        collateralApprovalTx: syntheticApprovalTx.tx
      });
    }

    for (;;) {
      const currentSyntheticBalance = await syntheticToken.balanceOf(accounts[0]);
      await liquidator.queryAndLiquidate(currentSyntheticBalance, liquidatorOverridePrice);
      await liquidator.queryAndWithdrawRewards();

      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        await waitForLogger(logger);
        break;
      }
      await delay(Number(pollingDelay));
    }
  } catch (error) {
    logger.error({
      at: "Liquidator#index",
      message: "Liquidator polling error🚨",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(logger);
  }
}

async function Poll(callback) {
  const logger = getLogger();

  try {
    await run({ logger });
  } catch (error) {
    logger.error({
      at: "Liquidator#index",
      message: "Liquidator configuration error🚨",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(logger);
    callback(error);
    return;
  }
  callback();
}

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
