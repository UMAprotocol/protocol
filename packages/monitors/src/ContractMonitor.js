// This module monitors Expiring Multi Party contracts and produce logs when: 1) new sponsors are detected,
// 2) liquidations are submitted, 3) liquidations are disputed or 4) disputes are resolved.

const {
  ConvertDecimals,
  createFormatFunction,
  createEtherscanLinkMarkdown,
  revertWrapper,
  createObjectFromDefaultProps
} = require("@uma/common");

class ContractMonitor {
  /**
  * @notice Constructs new contract monitor module.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} expiringMultiPartyEventClient Client used to query EMP events for contract state updates.
   * @param {Object} priceFeed Module used to query the current token price.
   * @param {Object} config Object containing two arrays of monitored liquidator and disputer bots to inform logs Example:
   *      { "monitoredLiquidators": ["0x1234","0x5678"],
   *        "monitoredDisputers": ["0x1234","0x5678"] }
   * @param {Object} empProps Configuration object used to inform logs of key EMP information. Example:
   *      { collateralCurrencySymbol: "DAI",
            syntheticCurrencySymbol:"ETHBTC",
            collateralCurrencyDecimals: 18,
            syntheticCurrencyDecimals: 18,
            priceIdentifier: "ETH/BTC",
            networkId:1 }
   * @param {Object} votingContract DVM to query price requests.
   */
  constructor({ logger, expiringMultiPartyEventClient, priceFeed, config, empProps, votingContract }) {
    this.logger = logger;

    // Offchain price feed to get the price for liquidations.
    this.priceFeed = priceFeed;

    // EMP event client to read latest contract events.
    this.empEventClient = expiringMultiPartyEventClient;
    this.empContract = this.empEventClient.emp;
    this.web3 = this.empEventClient.web3;

    // Voting contract to query resolved prices.
    this.votingContract = votingContract;

    // Previous contract state used to check for new entries between calls.
    this.lastLiquidationBlockNumber = 0;
    this.lastDisputeBlockNumber = 0;
    this.lastDisputeSettlementBlockNumber = 0;
    this.lastNewSponsorBlockNumber = 0;

    // Contract constants including collateralCurrencySymbol, syntheticCurrencySymbol, priceIdentifier and networkId
    this.empProps = empProps;

    this.convertCollateralToSynthetic = ConvertDecimals(
      empProps.collateralCurrencyDecimals,
      empProps.syntheticCurrencyDecimals,
      this.web3
    );

    this.formatDecimalStringCollateral = createFormatFunction(
      this.web3,
      2,
      4,
      false,
      empProps.collateralCurrencyDecimals
    );
    this.formatDecimalString = createFormatFunction(this.web3, 2, 4, false);

    // Bot and ecosystem accounts to monitor, overridden by config parameter.
    const defaultConfig = {
      // By default monitor no liquidator bots (empty array).
      monitoredLiquidators: {
        value: [],
        isValid: x => {
          // For the config to be valid it must be an array of address.
          return Array.isArray(x) && x.every(y => this.web3.utils.isAddress(y));
        }
      },
      monitoredDisputers: {
        value: [],
        isValid: x => {
          // For the config to be valid it must be an array of address.
          return Array.isArray(x) && x.every(y => this.web3.utils.isAddress(y));
        }
      },
      logOverrides: {
        // Specify an override object to change default logging behaviour. Defaults to no overrides. If specified, this
        // object is structured to contain key for the log to override and value for the logging level. EG:
        // { newPositionCreated:'debug' } would override the default `info` behaviour for newPositionCreated.
        value: {},
        isValid: overrides => {
          // Override must be one of the default logging levels: ['error','warn','info','http','verbose','debug','silly']
          return Object.values(overrides).every(param => Object.keys(this.logger.levels).includes(param));
        }
      }
    };

    Object.assign(this, createObjectFromDefaultProps(config, defaultConfig));

    // Helper functions from web3.
    this.toWei = this.web3.utils.toWei;
    this.toBN = this.web3.utils.toBN;
    this.utf8ToHex = this.web3.utils.utf8ToHex;
  }

  // Calculate the collateralization Ratio from the collateral, token amount and token price
  // This is cr = [collateral / (tokensOutstanding * price)] * 100
  calculatePositionCRPercent(collateral, tokensOutstanding, tokenPrice) {
    return this.toBN(this.convertCollateralToSynthetic(collateral))
      .mul(this.toBN(this.toWei("1")))
      .mul(this.toBN(this.toWei("1")))
      .div(this.toBN(tokensOutstanding).mul(this.toBN(tokenPrice.toString())))
      .muln(100);
  }

  // Calculate the maximum price at which this liquidation would be disputable using the `crRequirement`,
  // `liquidatedCollateral` and the `liquidatedTokens`.
  calculateDisputablePrice(crRequirement, liquidatedCollateral, liquidatedTokens) {
    const { toBN, toWei } = this.web3.utils;
    return toBN(this.convertCollateralToSynthetic(liquidatedCollateral))
      .mul(toBN(toWei("1")))
      .div(toBN(liquidatedTokens))
      .mul(toBN(toWei("1")))
      .div(toBN(crRequirement));
  }

  getLastSeenBlockNumber(eventArray) {
    if (eventArray.length == 0) {
      return 0;
    }
    return eventArray[eventArray.length - 1].blockNumber;
  }

  // Quries NewSponsor events since the latest query marked by `lastNewSponsorBlockNumber`.
  async checkForNewSponsors() {
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
        createEtherscanLinkMarkdown(event.sponsor, this.empProps.networkId) +
        (isMonitoredBot ? " (Monitored liquidator or disputer bot)" : "") +
        " created " +
        this.formatDecimalString(event.tokenAmount) +
        " " +
        this.empProps.syntheticCurrencySymbol +
        " backed by " +
        this.formatDecimalStringCollateral(event.collateralAmount) +
        " " +
        this.empProps.collateralCurrencySymbol +
        ". tx: " +
        createEtherscanLinkMarkdown(event.transactionHash, this.empProps.networkId);

      this.logger[this.logOverrides.newPositionCreated || "info"]({
        at: "ContractMonitor",
        message: "New Sponsor Alert 🐣!",
        mrkdwn: mrkdwn
      });
    }
    this.lastNewSponsorBlockNumber = this.getLastSeenBlockNumber(latestNewSponsorEvents);
  }

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  async checkForNewLiquidations() {
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
      const liquidationTime = (await this.web3.eth.getBlock(event.blockNumber)).timestamp;
      const price = this.priceFeed.getHistoricalPrice(parseInt(liquidationTime.toString()));
      let collateralizationString;
      let maxPriceToBeDisputableString;
      const crRequirement = await this.empContract.methods.collateralRequirement().call();
      let crRequirementString = this.web3.utils.toBN(crRequirement).muln(100);
      if (price) {
        collateralizationString = this.formatDecimalString(
          this.calculatePositionCRPercent(event.liquidatedCollateral, event.tokensOutstanding, price)
        );
        maxPriceToBeDisputableString = this.formatDecimalString(
          this.calculateDisputablePrice(crRequirement, event.liquidatedCollateral, event.tokensOutstanding)
        );
      } else {
        this.logger.warn({
          at: "ContractMonitor",
          message: "Could not get historical price for liquidation",
          price,
          liquidationTime: liquidationTime.toString()
        });
        collateralizationString = "[Invalid]";
        maxPriceToBeDisputableString = "[Invalid]";
      }

      // Sample message:
      // Liquidation alert: [ethereum address if third party, or “UMA” if it’s our bot]
      // initiated liquidation for for [x][collateral currency] (liquidated collateral = [y]) of sponsor collateral
      // backing[n] tokens. Sponsor collateralization was[y] %, using [p] as the estimated price at liquidation time.
      // With a collateralization requirement of [r]%, this liquidation would be disputable at a price below [l]. [etherscan link to txn]
      let mrkdwn =
        createEtherscanLinkMarkdown(event.liquidator, this.empProps.networkId) +
        (this.monitoredLiquidators.indexOf(event.liquidator) != -1 ? " (Monitored liquidator bot)" : "") +
        " initiated liquidation for " +
        this.formatDecimalStringCollateral(event.lockedCollateral) +
        " (liquidated collateral = " +
        this.formatDecimalStringCollateral(event.liquidatedCollateral) +
        ") " +
        this.empProps.collateralCurrencySymbol +
        " of sponsor " +
        createEtherscanLinkMarkdown(event.sponsor, this.empProps.networkId) +
        " collateral backing " +
        this.formatDecimalString(event.tokensOutstanding) +
        " " +
        this.empProps.syntheticCurrencySymbol +
        " tokens. ";
      // Add details about the liquidation price if historical data from the pricefeed is available.
      if (price) {
        mrkdwn +=
          "Sponsor collateralization was " +
          collateralizationString +
          "%. " +
          "Using " +
          this.formatDecimalString(price) + // price is scaled 1e18
          " as the estimated price at liquidation time. With a collateralization requirement of " +
          this.formatDecimalString(crRequirementString) +
          "%, this liquidation would be disputable at a price below " +
          maxPriceToBeDisputableString +
          ". ";
      }
      // Add etherscan link.
      mrkdwn += `Tx: ${createEtherscanLinkMarkdown(event.transactionHash, this.empProps.networkId)}`;
      this.logger.info({
        at: "ContractMonitor",
        message: "Liquidation Alert 🧙‍♂️!",
        mrkdwn: mrkdwn
      });
    }
    this.lastLiquidationBlockNumber = this.getLastSeenBlockNumber(latestLiquidationEvents);
  }

  async checkForNewDisputeEvents() {
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
        createEtherscanLinkMarkdown(event.disputer, this.empProps.networkId) +
        (this.monitoredDisputers.indexOf(event.disputer) != -1 ? " (Monitored dispute bot)" : "") +
        " initiated dispute against liquidator " +
        createEtherscanLinkMarkdown(event.liquidator, this.empProps.networkId) +
        (this.monitoredLiquidators.indexOf(event.liquidator) != -1 ? " (Monitored liquidator bot)" : "") +
        " with a dispute bond of " +
        this.formatDecimalStringCollateral(event.disputeBondAmount) +
        " " +
        this.empProps.collateralCurrencySymbol +
        ". tx: " +
        createEtherscanLinkMarkdown(event.transactionHash, this.empProps.networkId);

      this.logger.info({
        at: "ContractMonitor",
        message: "Dispute Alert 👻!",
        mrkdwn: mrkdwn
      });
    }
    this.lastDisputeBlockNumber = this.getLastSeenBlockNumber(latestDisputeEvents);
  }

  async checkForNewDisputeSettlementEvents() {
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
      let resolvedPrice;
      try {
        // Query resolved price for dispute price request. Note that this will return nothing if the
        // disputed liquidation's block timestamp is not equal to the timestamp of the price request. This could be the
        // the case if the EMP contract is using the Timer contract for example.
        const liquidationEvent = this.empEventClient
          .getAllLiquidationEvents()
          .find(_event => _event.sponsor === event.sponsor && _event.liquidationId === event.liquidationId);
        const liquidationTimestamp = (await this.web3.eth.getBlock(liquidationEvent.blockNumber)).timestamp;

        resolvedPrice = revertWrapper(
          await this.votingContract.getPrice(this.utf8ToHex(this.empProps.priceIdentifier), liquidationTimestamp, {
            from: this.empContract.options.address
          })
        );
      } catch (error) {
        // No price or matching liquidation available.
      }

      // Sample message:
      // Dispute settlement alert: Dispute between liquidator [ethereum address if third party,
      // or “UMA” if it’s our bot] and disputer [ethereum address if third party, or “UMA” if
      // it’s our bot]has resolved as [success or failed] [etherscan link to txn]
      let mrkdwn =
        "Dispute between liquidator " +
        createEtherscanLinkMarkdown(event.liquidator, this.empProps.networkId) +
        (this.monitoredLiquidators.indexOf(event.liquidator) != -1 ? " (Monitored liquidator bot)" : "") +
        " and disputer " +
        createEtherscanLinkMarkdown(event.disputer, this.empProps.networkId) +
        (this.monitoredDisputers.indexOf(event.disputer) != -1 ? " (Monitored dispute bot)" : "") +
        " has settled. ";
      // Add details about the resolved price request if available.
      if (resolvedPrice) {
        // NOTE: this will need to change back to formatDecimalString when the price feed is updated following
        // subsequent UMIPS.
        mrkdwn += `The disputed liquidation price resolved to: ${this.formatDecimalStringCollateral(
          resolvedPrice
        )}, which resulted in a ${event.disputeSucceeded ? "successful" : "failed"} dispute. `;
      } else {
        mrkdwn += `The disputed liquidation ${event.disputeSucceeded ? "succeeded" : "failed"}. `;
      }
      // Add etherscan link.
      mrkdwn += `Tx: ${createEtherscanLinkMarkdown(event.transactionHash, this.empProps.networkId)}`;
      this.logger.info({
        at: "ContractMonitor",
        message: "Dispute Settlement Alert 👮‍♂️!",
        mrkdwn: mrkdwn
      });
    }
    this.lastDisputeSettlementBlockNumber = this.getLastSeenBlockNumber(latestDisputeSettlementEvents);
  }
}

module.exports = {
  ContractMonitor
};
