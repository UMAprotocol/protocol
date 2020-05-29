const { createFormatFunction, createEtherscanLinkMarkdown } = require("./common/FormattingUtils");

class ContractMonitor {
  constructor(logger, expiringMultiPartyEventClient, contractMonitorConfigObject, priceFeed) {
    this.logger = logger;

    // Bot and ecosystem accounts to monitor. Will inform the console logs when events are detected from these accounts.
    this.monitoredLiquidators = contractMonitorConfigObject.monitoredLiquidators;
    this.monitoredDisputers = contractMonitorConfigObject.monitoredDisputers;

    // Offchain price feed to get the price for liquidations.
    this.priceFeed = priceFeed;

    // EMP event client to read latest contract events.
    this.empEventClient = expiringMultiPartyEventClient;
    this.empContract = this.empEventClient.emp;
    this.web3 = this.empEventClient.web3;

    // Previous contract state used to check for new entries between calls.
    this.lastLiquidationBlockNumber = 0;
    this.lastDisputeBlockNumber = 0;
    this.lastDisputeSettlementBlockNumber = 0;
    this.lastNewSponsorBlockNumber = 0;

    // Contract constants
    // TODO: replace this with an actual query to the collateral currency symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "ETHBTC";

    // TODO: get the decimals of the collateral currency and use this to scale the output appropriately for non 1e18 colat
    this.formatDecimalString = createFormatFunction(this.web3, 2);
  }

  // Calculate the collateralization Ratio from the collateral, token amount and token price
  // This is cr = [collateral / (tokensOutstanding * price)] * 100
  calculatePositionCRPercent = (collateral, tokensOutstanding, tokenPrice) => {
    return this.web3.utils
      .toBN(collateral)
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .div(this.web3.utils.toBN(tokensOutstanding).mul(this.web3.utils.toBN(tokenPrice.toString())))
      .muln(100);
  };

  getLastSeenBlockNumber(eventArray) {
    if (eventArray.length == 0) {
      return 0;
    }
    return eventArray[eventArray.length - 1].blockNumber;
  }

  // Quries NewSponsor events since the latest query marked by `lastNewSponsorBlockNumber`.
  checkForNewSponsors = async () => {
    this.logger.debug({
      at: "ContractMonitor",
      message: "Checking for new sponsor events",
      lastNewSponsorBlockNumber: this.lastNewSponsorBlockNumber
    });

    // Get the latest new sponsor information.
    let latestNewSponsorEvents = this.empEventClient.getAllNewSponsorEvents();

    // Get events that are newer than the last block number we've seen
    let newSponsorEvents = latestNewSponsorEvents.filter(event => event.blockNumber > this.lastNewSponsorBlockNumber);

    for (let event of newSponsorEvents) {
      // Check if new sponsor is UMA bot.
      const isLiquidatorBot = this.monitoredLiquidators.indexOf(event.sponsor);
      const isDisputerBot = this.monitoredDisputers.indexOf(event.sponsor);
      const isMonitoredBot = Boolean(isLiquidatorBot != -1 || isDisputerBot != -1);

      // Sample message:
      // New sponsor alert: [ethereum address if third party, or “UMA” if it’s our bot]
      // created X tokens backed by Y collateral.  [etherscan link to txn]
      const mrkdwn =
        createEtherscanLinkMarkdown(event.sponsor, await this.web3.eth.net.getId()) +
        (isMonitoredBot ? " (Monitored liquidator or disputer bot)" : "") +
        " created " +
        this.formatDecimalString(event.tokenAmount) +
        " " +
        this.syntheticCurrencySymbol +
        " backed by " +
        this.formatDecimalString(event.collateralAmount) +
        " " +
        this.collateralCurrencySymbol +
        ". tx: " +
        createEtherscanLinkMarkdown(event.transactionHash, await this.web3.eth.net.getId());

      this.logger.info({
        at: "ContractMonitor",
        message: "New Sponsor Alert 🐣!",
        mrkdwn: mrkdwn
      });
    }
    this.lastNewSponsorBlockNumber = this.getLastSeenBlockNumber(latestNewSponsorEvents);
  };

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  checkForNewLiquidations = async () => {
    this.logger.debug({
      at: "ContractMonitor",
      message: "Checking for new liquidation events",
      lastLiquidationBlockNumber: this.lastLiquidationBlockNumber
    });

    // Get the latest liquidation information.
    let latestLiquidationEvents = this.empEventClient.getAllLiquidationEvents();

    // Get liquidation events that are newer than the last block number we've seen
    let newLiquidationEvents = latestLiquidationEvents.filter(
      event => event.blockNumber > this.lastLiquidationBlockNumber
    );

    for (let event of newLiquidationEvents) {
      const { liquidationTime } = await this.empContract.methods
        .liquidations(event.sponsor, event.liquidationId)
        .call();
      const price = this.priceFeed.getHistoricalPrice(parseInt(liquidationTime.toString()));

      let collateralizationString;
      if (price) {
        collateralizationString = this.formatDecimalString(
          this.calculatePositionCRPercent(event.liquidatedCollateral, event.tokensOutstanding, price)
        );
      } else {
        this.logger.warn({
          at: "ContractMonitor",
          message: "Could not get historical price for liquidation",
          price,
          liquidationTime: liquidationTime.toString()
        });
        collateralizationString = "[Invalid]";
      }

      // Sample message:
      // Liquidation alert: [ethereum address if third party, or “UMA” if it’s our bot]
      // initiated liquidation for for [x][collateral currency]of sponsor collateral
      // backing[n] tokens - sponsor collateralization was[y] %.  [etherscan link to txn]
      const mrkdwn =
        createEtherscanLinkMarkdown(event.liquidator, await this.web3.eth.net.getId()) +
        (this.monitoredLiquidators.indexOf(event.liquidator) != -1 ? " (Monitored liquidator bot)" : "") +
        " initiated liquidation for " +
        this.formatDecimalString(event.liquidatedCollateral) +
        " " +
        this.collateralCurrencySymbol +
        " of sponsor " +
        createEtherscanLinkMarkdown(event.sponsor, await this.web3.eth.net.getId()) +
        " collateral backing " +
        this.formatDecimalString(event.tokensOutstanding) +
        " " +
        this.syntheticCurrencySymbol +
        " tokens. Sponsor collateralization was " +
        collateralizationString +
        "%. tx: " +
        createEtherscanLinkMarkdown(event.transactionHash, await this.web3.eth.net.getId());

      this.logger.info({
        at: "ContractMonitor",
        message: "Liquidation Alert 🧙‍♂️!",
        mrkdwn: mrkdwn
      });
    }
    this.lastLiquidationBlockNumber = this.getLastSeenBlockNumber(latestLiquidationEvents);
  };

  checkForNewDisputeEvents = async () => {
    this.logger.debug({
      at: "ContractMonitor",
      message: "Checking for new dispute events",
      lastDisputeBlockNumber: this.lastDisputeBlockNumber
    });

    // Get the latest dispute information.
    let latestDisputeEvents = this.empEventClient.getAllDisputeEvents();

    let newDisputeEvents = latestDisputeEvents.filter(event => event.blockNumber > this.lastDisputeBlockNumber);

    for (let event of newDisputeEvents) {
      // Sample message:
      // Dispute alert: [ethereum address if third party, or “UMA” if it’s our bot]
      // initiated dispute [etherscan link to txn]
      const mrkdwn =
        createEtherscanLinkMarkdown(event.disputer, await this.web3.eth.net.getId()) +
        (this.monitoredDisputers.indexOf(event.disputer) != -1 ? " (Monitored dispute bot)" : "") +
        " initiated dispute against liquidator " +
        createEtherscanLinkMarkdown(event.liquidator, await this.web3.eth.net.getId()) +
        (this.monitoredLiquidators.indexOf(event.liquidator) != -1 ? " (Monitored liquidator bot)" : "") +
        " with a dispute bond of " +
        this.formatDecimalString(event.disputeBondAmount) +
        " " +
        this.collateralCurrencySymbol +
        ". tx: " +
        createEtherscanLinkMarkdown(event.transactionHash, await this.web3.eth.net.getId());

      this.logger.info({
        at: "ContractMonitor",
        message: "Dispute Alert 👻!",
        mrkdwn: mrkdwn
      });
    }
    this.lastDisputeBlockNumber = this.getLastSeenBlockNumber(latestDisputeEvents);
  };

  checkForNewDisputeSettlementEvents = async () => {
    this.logger.debug({
      at: "ContractMonitor",
      message: "Checking for new dispute settlement events",
      lastDisputeSettlementBlockNumber: this.lastDisputeSettlementBlockNumber
    });

    // Get the latest disputeSettlement information.
    let latestDisputeSettlementEvents = this.empEventClient.getAllDisputeSettlementEvents();

    let newDisputeSettlementEvents = latestDisputeSettlementEvents.filter(
      event => event.blockNumber > this.lastDisputeSettlementBlockNumber
    );

    for (let event of newDisputeSettlementEvents) {
      // Sample message:
      // Dispute settlement alert: Dispute between liquidator [ethereum address if third party,
      // or “UMA” if it’s our bot] and disputer [ethereum address if third party, or “UMA” if
      // it’s our bot]has resolved as [success or failed] [etherscan link to txn]
      const mrkdwn =
        "Dispute between liquidator " +
        createEtherscanLinkMarkdown(event.liquidator, await this.web3.eth.net.getId()) +
        (this.monitoredLiquidators.indexOf(event.liquidator) != -1 ? "(Monitored liquidator bot)" : "") +
        " and disputer " +
        createEtherscanLinkMarkdown(event.disputer, await this.web3.eth.net.getId()) +
        (this.monitoredDisputers.indexOf(event.disputer) != -1 ? "(Monitored dispute bot)" : "") +
        " has been resolved as " +
        (event.disputeSucceeded == true ? "success" : "failed") +
        ". tx: " +
        createEtherscanLinkMarkdown(event.transactionHash, await this.web3.eth.net.getId());
      this.logger.info({
        at: "ContractMonitor",
        message: "Dispute Settlement Alert 👮‍♂️!",
        mrkdwn: mrkdwn
      });
    }
    this.lastDisputeSettlementBlockNumber = this.getLastSeenBlockNumber(latestDisputeSettlementEvents);
  };
}

module.exports = {
  ContractMonitor
};
