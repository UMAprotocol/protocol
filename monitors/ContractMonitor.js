const { Logger } = require("../financial-templates-lib/logger/Logger");

const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");
const networkUtils = require("../common/PublicNetworks");

// const { toBN, toWei, fromWei } = this.web3.utils;

class ContractMonitor {
  constructor(expiringMultiPartyEventClient, account, umaLiquidatorAddress, umaDisputerAddress) {
    // Bot and ecosystem accounts.
    this.account = account;
    this.umaLiquidatorAddress = umaLiquidatorAddress;
    this.umaDisputerAddress = umaDisputerAddress;

    // Previous contract state used to check for new entries between calls
    this.lastLiquidationEvents = [];
    this.lastDisputeEvents = [];
    this.lastDisputeSettlementEvents = [];

    // Instance of the expiring multiparty to perform on-chain queries
    this.empEventClient = expiringMultiPartyEventClient;
    this.web3 = this.empEventClient.web3;

    // Contract constants
    //TODO: replace this with an actual query to the collateral currency symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";

    // TODO: get the decimals of the collateral currency and use this to scale the output appropriately for non 1e18 colat
    this.formatDecimalString = createFormatFunction(this.web3, 2);
  }

  // Calculate the collateralization Ratio from the collateral, token amount and token price
  // This is cr = [collateral / (tokensOutstanding * price)] * 100
  calculatePositionCRPercent = (collateral, tokensOutstanding, priceFunction) => {
    return this.web3.utils
      .toBN(collateral)
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .div(this.web3.utils.toBN(tokensOutstanding).mul(this.web3.utils.toBN(priceFunction.toString())))
      .muln(100);
  };

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  checkForNewLiquidations = async priceFunction => {
    Logger.debug({
      at: "ContractMonitor",
      message: "Checking for new liquidation events",
      price: priceFunction.toString()
    });

    // Get the latest liquidation information.
    let latestLiquidationEvents = this.empEventClient.getAllLiquidationEvents();

    // Get the block number of the last event stored within the ContractMonitor.
    let highestOldBlockNumber =
      this.lastLiquidationEvents.length > 0
        ? this.lastLiquidationEvents[this.lastLiquidationEvents.length - 1].blockNumber
        : 0;
    let newLiquidationEvents = latestLiquidationEvents.filter(event => event.blockNumber > highestOldBlockNumber);

    for (let event of newLiquidationEvents) {
      // Sample message:
      // Liquidation alert: [ethereum address if third party, or “UMA” if it’s our bot]
      // initiated liquidation for for [x][collateral currency]of sponsor collateral
      // backing[n] tokens - sponsor collateralization was[y] %.  [etherscan link to txn]
      const markwn =
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.liquidator) +
        (this.umaLiquidatorAddress == event.liquidator ? " (UMA liquidator bot)" : "") +
        " initiated liquidation for " +
        this.formatDecimalString(event.liquidatedCollateral) +
        " " +
        this.collateralCurrencySymbol +
        " of sponsor " +
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.sponsor) +
        " collateral backing " +
        this.formatDecimalString(event.tokensOutstanding) +
        " " +
        this.syntheticCurrencySymbol +
        " tokens. Sponsor collateralization was " +
        this.formatDecimalString(
          this.calculatePositionCRPercent(event.liquidatedCollateral, event.tokensOutstanding, priceFunction)
        ) +
        "%. tx: " +
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.transactionHash);

      Logger.info({
        at: "ContractMonitor",
        message: "Liquidation Alert 🧙‍♂️!",
        markwn: markwn
      });
    }
    this.lastLiquidationEvents = JSON.parse(JSON.stringify(latestLiquidationEvents));
  };

  checkForNewDisputeEvents = async priceFunction => {
    Logger.debug({
      at: "ContractMonitor",
      message: "Checking for new dispute events",
      price: priceFunction.toString()
    });

    // Get the latest dispute information.
    let latestDisputeEvents = this.empEventClient.getAllDisputeEvents();

    // Get the block number of the last event stored within the ContractMonitor.
    let highestOldBlockNumber =
      this.lastDisputeEvents.length > 0 ? this.lastDisputeEvents[this.lastDisputeEvents.length - 1].blockNumber : 0;
    let newDisputeEvents = latestDisputeEvents.filter(event => event.blockNumber > highestOldBlockNumber);

    for (let event of newDisputeEvents) {
      // Sample message:
      // Dispute alert: [ethereum address if third party, or “UMA” if it’s our bot]
      // initiated dispute [etherscan link to txn]
      const markwn =
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.disputer) +
        (this.umaDisputerAddress == event.disputer ? " (UMA dispute bot)" : "") +
        " initiated dispute against liquidator " +
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.liquidator) +
        (this.umaLiquidatorAddress == event.liquidator ? " (UMA liquidator bot)" : "") +
        " with a dispute bond of " +
        this.formatDecimalString(event.disputeBondAmount) +
        " ";
      this.collateralCurrencySymbol +
        ". tx: " +
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.transactionHash);

      Logger.info({
        at: "ContractMonitor",
        message: "Dispute Alert 👻!",
        markwn: markwn
      });
    }
    this.lastDisputeEvents = JSON.parse(JSON.stringify(latestDisputeEvents));
  };

  checkForNewDisputeSettlementEvents = async priceFunction => {
    Logger.debug({
      at: "ContractMonitor",
      message: "Checking for new dispute settlement events",
      price: priceFunction.toString()
    });

    // Get the latest disputeSettlement information.
    let latestDisputeSettlementEvents = this.empEventClient.getAllDisputeSettlementEvents();

    // Get the block number of the last event stored within the ContractMonitor.
    let highestOldBlockNumber =
      this.lastDisputeSettlementEvents.length > 0
        ? this.lastDisputeSettlementEvents[this.lastDisputeSettlementEvents.length - 1].blockNumber
        : 0;
    let newDisputeSettlementEvents = latestDisputeSettlementEvents.filter(
      event => event.blockNumber > highestOldBlockNumber
    );

    for (let event of newDisputeSettlementEvents) {
      // Sample message:
      // Dispute settlement alert: Dispute between liquidator [ethereum address if third party,
      // or “UMA” if it’s our bot] and disputer [ethereum address if third party, or “UMA” if
      // it’s our bot]has resolved as [success or failed] [etherscan link to txn]
      const markwn =
        "Dispute between liquidator " +
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.liquidator) +
        (this.umaLiquidatorAddress == event.liquidator ? "(UMA liquidator bot)" : "") +
        " and disputer " +
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.disputer) +
        (this.umaDisputerAddress == event.disputer ? "(UMA dispute bot)" : "") +
        " has been resolved as " +
        (event.disputeSucceeded == true ? "success" : "failed") +
        ". tx: " +
        createEtherscanLinkMarkdown(this.web3, networkUtils, event.transactionHash);
      Logger.info({
        at: "ContractMonitor",
        message: "Dispute Settlement Alert 👮‍♂️!",
        markwn: markwn
      });
    }
    this.lastDisputeSettlementEvents = JSON.parse(JSON.stringify(latestDisputeSettlementEvents));
  };
}

module.exports = {
  ContractMonitor
};
