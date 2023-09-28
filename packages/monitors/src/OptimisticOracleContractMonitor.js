// This module monitors OptimisticOracle contracts and produce logs when new price requests are submitted, proposed to, disputed, and settled.

// TODO: Use pricefeed mapping from proposer bot to fetch approximate prices for each price request to give more log information. This probably means
// refactoring the pricefeed mapping out of the proposer bot so it can be shared amongst clients.
const {
  createEtherscanLinkMarkdown,
  createObjectFromDefaultProps,
  ZERO_ADDRESS,
  createFormatFunction,
  ConvertDecimals,
  parseAncillaryData,
} = require("@uma/common");
const { OptimisticOracleType } = require("@uma/financial-templates-lib");
const { getAbi } = require("@uma/contracts-node");

class OptimisticOracleContractMonitor {
  /**
   * @notice Constructs new contract monitor module.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} optimisticOracleContractEventClient Client used to query OptimisticOracle Contract events for contract state updates.
   * @param {Object} monitorConfig Monitor setting overrides such as log overrides.
   * @param {Object} contractProps Configuration object used to inform logs of key contract information. Example:
   *        E.g. { networkId:1 }
   */
  constructor({ logger, optimisticOracleContractEventClient, monitorConfig, contractProps }) {
    this.logger = logger;

    // OptimisticOracle Contract event client to read latest contract events.
    this.optimisticOracleContractEventClient = optimisticOracleContractEventClient;
    this.oracleType = optimisticOracleContractEventClient.oracleType;
    this.optimisticOracleContract = this.optimisticOracleContractEventClient.optimisticOracleContract;
    this.web3 = this.optimisticOracleContractEventClient.web3;

    // Previous contract state used to check for new entries between calls.
    this.lastRequestPriceBlockNumber = 0;
    this.lastProposePriceBlockNumber = 0;
    this.lastDisputePriceBlockNumber = 0;
    this.lastSettlementBlockNumber = 0;

    // Formats an 18 decimal point string with a define number of decimals and precision for use in message generation.
    this.formatDecimalString = createFormatFunction(2, 4, false);

    // Bot and ecosystem accounts to monitor, overridden by monitorConfig parameter.
    const defaultConfig = {
      logOverrides: {
        // Specify an override object to change default logging behaviour. Defaults to no overrides. If specified, this
        // object is structured to contain key for the log to override and value for the logging level. EG:
        // { newPositionCreated:'debug' } would override the default `info` behaviour for newPositionCreated.
        value: {},
        isValid: (overrides) => {
          // Override must be one of the default logging levels: ['error','warn','info','http','verbose','debug','silly']
          return Object.values(overrides).every((param) => Object.keys(this.logger.levels).includes(param));
        },
      },
      optimisticOracleUIBaseUrl: {
        // Base URL for the Optimistic Oracle UI.
        value: "https://oracle.uma.xyz",
        isValid: (x) => typeof x === "string",
      },
    };

    Object.assign(this, createObjectFromDefaultProps(monitorConfig, defaultConfig));

    // Validate the contractProps object. This contains a set of important info within it so need to be sure it's structured correctly.
    const defaultContractProps = {
      contractProps: {
        value: {},
        isValid: (x) => {
          // The config must contain the following keys and types:
          return (
            Object.keys(x).includes("networkId") &&
            typeof x.networkId === "number" &&
            Object.keys(x).includes("chainId") &&
            typeof x.chainId === "number"
          );
        },
      },
    };
    Object.assign(this, createObjectFromDefaultProps({ contractProps }, defaultContractProps));

    // Helper functions from web3.
    this.toWei = this.web3.utils.toWei;
    this.toBN = this.web3.utils.toBN;
    this.utf8ToHex = this.web3.utils.utf8ToHex;
    this.padRight = this.web3.utils.padRight;
    this.toChecksumAddress = this.web3.utils.toChecksumAddress;
  }

  // Queries RequestPrice events since the latest query marked by `lastRequestPriceBlockNumber`.
  async checkForRequests() {
    this.logger.debug({
      at: "OptimisticOracleContractMonitor",
      message: "Checking for RequestPrice events",
      lastRequestPriceBlockNumber: this.lastRequestPriceBlockNumber,
    });

    let latestEvents = this.optimisticOracleContractEventClient.getAllRequestPriceEvents();

    // Get events that are newer than the last block number we've seen
    latestEvents = latestEvents.filter((event) => event.blockNumber > this.lastRequestPriceBlockNumber);

    for (let event of latestEvents) {
      const convertCollateralDecimals = await this._getCollateralDecimalsConverted(
        this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.currency : event.request.currency
      );
      const mrkdwn =
        createEtherscanLinkMarkdown(event.requester, this.contractProps.networkId) +
        ` requested a price at the timestamp ${event.timestamp} for the identifier: ${event.identifier}.\n` +
        this._formatAncillaryData(event.ancillaryData) +
        `. \nCollateral currency address is ${
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.currency : event.request.currency
        }. Reward amount is ${this.formatDecimalString(
          convertCollateralDecimals(
            this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.reward : event.request.reward
          )
        )} and the final fee is ${this.formatDecimalString(
          convertCollateralDecimals(
            this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.finalFee : event.request.finalFee
          )
        )}. tx: ${createEtherscanLinkMarkdown(
          event.transactionHash,
          this.contractProps.networkId
        )}. ${this._generateUILink(event.transactionHash, event.logIndex, this.contractProps.networkId)}.`;

      // The default log level should be reduced to "debug" for funding rate identifiers:
      this.logger[
        this.logOverrides.requestedPrice || (this._isFundingRateIdentifier(event.identifier) ? "debug" : "error")
      ]({
        at: "OptimisticOracleContractMonitor",
        message: `${this.oracleType}: Price Request Alert 👮🏻!`,
        mrkdwn,
        discordPaths: ["oo-events"],
        notificationPath: "optimistic-oracle",
      });
    }
    this.lastRequestPriceBlockNumber = this._getLastSeenBlockNumber(latestEvents);
  }

  // Queries ProposePrice events since the latest query marked by `lastProposePriceBlockNumber`.
  async checkForProposals() {
    this.logger.debug({
      at: "OptimisticOracleContractMonitor",
      message: "Checking for ProposePrice events",
      lastProposePriceBlockNumber: this.lastProposePriceBlockNumber,
    });

    let latestEvents = this.optimisticOracleContractEventClient.getAllProposePriceEvents();

    // Get events that are newer than the last block number we've seen
    latestEvents = latestEvents.filter((event) => event.blockNumber > this.lastProposePriceBlockNumber);

    for (let event of latestEvents) {
      const mrkdwn =
        createEtherscanLinkMarkdown(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.proposer : event.request.proposer,
          this.contractProps.networkId
        ) +
        ` proposed a price for the request made by ${createEtherscanLinkMarkdown(event.requester)} at the timestamp ${
          event.timestamp
        } for the identifier: ${event.identifier}. ` +
        `\nThe proposal price of ${this.formatDecimalString(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle
            ? event.proposedPrice
            : event.request.proposedPrice
        )} will expire at ${
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle
            ? event.expirationTimestamp
            : event.request.expirationTime
        }.\n` +
        this._formatAncillaryData(event.ancillaryData) +
        `.\n Collateral currency address is ${createEtherscanLinkMarkdown(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.currency : event.request.currency
        )}. ` +
        `tx ${createEtherscanLinkMarkdown(event.transactionHash, this.contractProps.networkId)}. ${this._generateUILink(
          event.transactionHash,
          event.logIndex,
          this.contractProps.networkId
        )}.`;

      // The default log level should be reduced to "info" for funding rate identifiers:
      this.logger.info({
        at: "OptimisticOracleContractMonitor",
        message: `${this.oracleType}: Price Proposal Alert 🧞‍♂️!`,
        mrkdwn,
        discordPaths: ["oo-fact-checking", "oo-events"],
        discordTicketChannel: "verifications-start-here",
        notificationPath: "optimistic-oracle",
      });
    }
    this.lastProposePriceBlockNumber = this._getLastSeenBlockNumber(latestEvents);
  }

  // Queries DisputePrice events since the latest query marked by `lastDisputePriceBlockNumber`.
  async checkForDisputes() {
    this.logger.debug({
      at: "OptimisticOracleContractMonitor",
      message: "Checking for DisputePrice events",
      lastDisputePriceBlockNumber: this.lastDisputePriceBlockNumber,
    });

    let latestEvents = this.optimisticOracleContractEventClient.getAllDisputePriceEvents();

    // Get events that are newer than the last block number we've seen
    latestEvents = latestEvents.filter((event) => event.blockNumber > this.lastDisputePriceBlockNumber);

    for (let event of latestEvents) {
      const mrkdwn =
        createEtherscanLinkMarkdown(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.disputer : event.request.disputer,
          this.contractProps.networkId
        ) +
        ` disputed a price for the request made by ${createEtherscanLinkMarkdown(event.requester)} at the timestamp ${
          event.timestamp
        } for the identifier: ${event.identifier}. ` +
        `The proposer ${createEtherscanLinkMarkdown(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.proposer : event.request.proposer
        )} proposed a price of ${this.formatDecimalString(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle
            ? event.proposedPrice
            : event.request.proposedPrice
        )}.\n` +
        this._formatAncillaryData(event.ancillaryData) +
        `. tx: ${createEtherscanLinkMarkdown(
          event.transactionHash,
          this.contractProps.networkId
        )}. ${this._generateUILink(event.transactionHash, event.logIndex, this.contractProps.networkId)}.`;

      this.logger[this.logOverrides.disputedPrice || "error"]({
        at: "OptimisticOracleContractMonitor",
        message: `${this.oracleType}: Price Dispute Alert ⛔️!`,
        mrkdwn,
        notificationPath: "optimistic-oracle-disputes",
      });
    }
    this.lastDisputePriceBlockNumber = this._getLastSeenBlockNumber(latestEvents);
  }

  // Queries Settle events since the latest query marked by `lastSettlementBlockNumber`.
  async checkForSettlements() {
    this.logger.debug({
      at: "OptimisticOracleContractMonitor",
      message: "Checking for Settle events",
      lastSettlementBlockNumber: this.lastSettlementBlockNumber,
    });

    let latestEvents = this.optimisticOracleContractEventClient.getAllSettlementEvents();

    // Get events that are newer than the last block number we've seen
    latestEvents = latestEvents.filter((event) => event.blockNumber > this.lastSettlementBlockNumber);

    for (let event of latestEvents) {
      const convertCollateralDecimals = await this._getCollateralDecimalsConverted(
        this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.currency : event.request.currency
      );
      let payout, isDispute;
      if (this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle) {
        payout = event.payout;
        isDispute = Boolean(event.disputer !== ZERO_ADDRESS);
      } else {
        payout = this.web3.utils.toBN(event.request.bond);
        isDispute = Boolean(event.request.disputer !== ZERO_ADDRESS);
        if (isDispute) {
          // If settlement was a disputed price request, then payout includes 1.5x proposer bond instead of 1x
          payout = payout.mul(this.web3.utils.toBN("3")).div(this.web3.utils.toBN("2"));
        }
        payout = payout
          .add(this.web3.utils.toBN(event.request.finalFee))
          .add(this.web3.utils.toBN(event.request.reward))
          .toString();
      }
      const mrkdwn =
        `Detected a price request settlement for the request made by ${createEtherscanLinkMarkdown(
          event.requester
        )} at the timestamp ${event.timestamp} for the identifier: ${event.identifier}. ` +
        `The proposer was ${createEtherscanLinkMarkdown(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.proposer : event.request.proposer
        )} and the disputer was ${createEtherscanLinkMarkdown(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.disputer : event.request.disputer
        )}. ` +
        `The settlement price is ${this.formatDecimalString(
          this.oracleType !== OptimisticOracleType.SkinnyOptimisticOracle ? event.price : event.request.resolvedPrice
        )}. ` +
        `The payout was ${this.formatDecimalString(convertCollateralDecimals(payout))} made to the ${
          isDispute ? "winner of the dispute" : "proposer"
        }.\n` +
        this._formatAncillaryData(event.ancillaryData) +
        `. tx: ${createEtherscanLinkMarkdown(
          event.transactionHash,
          this.contractProps.networkId
        )}. ${this._generateUILink(event.transactionHash, event.logIndex, this.contractProps.networkId)}.`;

      // The default log level should be reduced to "debug" for funding rate identifiers:
      this.logger[
        this.logOverrides.settledPrice || (this._isFundingRateIdentifier(event.identifier) ? "debug" : "info")
      ]({
        at: "OptimisticOracleContractMonitor",
        message: `${this.oracleType}: Price Settlement Alert 🏧!`,
        mrkdwn,
        notificationPath: "optimistic-oracle",
        discordPaths: null,
      });
    }
    this.lastSettlementBlockNumber = this._getLastSeenBlockNumber(latestEvents);
  }

  // Returns helper method for converting collateral token to human readable form.
  async _getCollateralDecimalsConverted(currencyAddress) {
    const collateralContract = new this.web3.eth.Contract(getAbi("ExpandedERC20"), currencyAddress);
    let collateralDecimals = await collateralContract.methods.decimals().call();
    return ConvertDecimals(collateralDecimals.toString(), 18, this.web3);
  }

  _getLastSeenBlockNumber(eventArray) {
    if (eventArray.length == 0) {
      return 0;
    }
    return eventArray[eventArray.length - 1].blockNumber;
  }

  // We make the assumption that identifiers that end with "_fr" like "ethbtc_fr" are funding rate identifiers,
  // and we should lower the alert levels for such price requests because we expect them to appear often.
  _isFundingRateIdentifier(identifier) {
    return identifier.toLowerCase().endsWith("_fr");
  }

  _formatAncillaryData(ancillaryData) {
    try {
      // Return the decoded ancillary data as a string. The `replace` syntax removes any escaped quotes from the string.
      return "Ancillary data: " + JSON.stringify(parseAncillaryData(ancillaryData)).replace(/"/g, "");
    } catch (_) {
      try {
        // If that fails, try to return the ancillary data UTF-8 decoded.
        return "Ancillary data: " + this.web3.utils.hexToUtf8(ancillaryData);
      } catch (_) {
        return "Could not parse ancillary data nor UTF-8 decode: " + ancillaryData || "0x";
      }
    }
  }

  _generateUILink(transactionHash, eventIndex, chainId) {
    let oracleType;
    switch (this.oracleType) {
      case OptimisticOracleType.OptimisticOracle:
        oracleType = "Optimistic+Oracle+V1";
        break;
      case OptimisticOracleType.OptimisticOracleV2:
        oracleType = "Optimistic+Oracle+V2";
        break;
      case OptimisticOracleType.SkinnyOptimisticOracle:
        oracleType = "Skinny+Optimistic+Oracle";
        break;
    }
    return `<${this.optimisticOracleUIBaseUrl}/?transactionHash=${transactionHash}&eventIndex=${eventIndex}&chainId=${chainId}&oracleType=${oracleType}|View in UI>`;
  }
}

module.exports = { OptimisticOracleContractMonitor };
