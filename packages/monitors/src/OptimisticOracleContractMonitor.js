// This module monitors OptimisticOracle contracts and produce logs when new price requests are submitted, proposed to, disputed, and settled.

// TODO: Use pricefeed mapping from proposer bot to fetch approximate prices for each price request to give more log information. This probably means
// refactoring the pricefeed mapping out of the proposer bot so it can be shared amongst clients.
const { createEtherscanLinkMarkdown, createObjectFromDefaultProps, ZERO_ADDRESS } = require("@uma/common");

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
    this.optimisticOracleContract = this.optimisticOracleContractEventClient.optimisticOracleContract;
    this.web3 = this.optimisticOracleContractEventClient.web3;

    // Previous contract state used to check for new entries between calls.
    this.lastRequestPriceBlockNumber = 0;
    this.lastProposePriceBlockNumber = 0;
    this.lastDisputePriceBlockNumber = 0;
    this.lastSettlementBlockNumber = 0;

    // Bot and ecosystem accounts to monitor, overridden by monitorConfig parameter.
    const defaultConfig = {
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

    Object.assign(this, createObjectFromDefaultProps(monitorConfig, defaultConfig));

    // Validate the contractProps object. This contains a set of important info within it so need to be sure it's structured correctly.
    const defaultContractProps = {
      contractProps: {
        value: {},
        isValid: x => {
          // The config must contain the following keys and types:
          return Object.keys(x).includes("networkId") && typeof x.networkId === "number";
        }
      }
    };
    Object.assign(this, createObjectFromDefaultProps({ contractProps }, defaultContractProps));

    // Helper functions from web3.
    this.toWei = this.web3.utils.toWei;
    this.toBN = this.web3.utils.toBN;
    this.utf8ToHex = this.web3.utils.utf8ToHex;
  }

  // Queries RequestPrice events since the latest query marked by `lastRequestPriceBlockNumber`.
  async checkForRequests() {
    this.logger.debug({
      at: "OptimisticOracleContractMonitor",
      message: "Checking for RequestPrice events",
      lastRequestPriceBlockNumber: this.lastRequestPriceBlockNumber
    });

    let latestEvents = this.optimisticOracleContractEventClient.getAllRequestPriceEvents();

    // Get events that are newer than the last block number we've seen
    latestEvents = latestEvents.filter(event => event.blockNumber > this.lastRequestPriceBlockNumber);

    for (let event of latestEvents) {
      const mrkdwn =
        createEtherscanLinkMarkdown(event.requester, this.contractProps.networkId) +
        ` requested a price at the timestamp ${event.timestamp} for the identifier: ${event.identifier}. ` +
        `The ancillary data field is ${event.ancillaryData}. ` +
        `Collateral currency address is ${event.currency}. Reward amount is ${event.reward} and the final fee is ${event.finalFee}. ` +
        `tx: ${createEtherscanLinkMarkdown(event.transactionHash, this.contractProps.networkId)}`;

      this.logger[this.logOverrides.requestedPrice || "error"]({
        at: "OptimisticOracleContractMonitor",
        message: "Price Request Alert 👮🏻!",
        mrkdwn: mrkdwn
      });
    }
    this.lastRequestPriceBlockNumber = this._getLastSeenBlockNumber(latestEvents);
  }

  // Queries ProposePrice events since the latest query marked by `lastProposePriceBlockNumber`.
  async checkForProposals() {
    this.logger.debug({
      at: "OptimisticOracleContractMonitor",
      message: "Checking for ProposePrice events",
      lastProposePriceBlockNumber: this.lastProposePriceBlockNumber
    });

    let latestEvents = this.optimisticOracleContractEventClient.getAllProposePriceEvents();

    // Get events that are newer than the last block number we've seen
    latestEvents = latestEvents.filter(event => event.blockNumber > this.lastProposePriceBlockNumber);

    for (let event of latestEvents) {
      const mrkdwn =
        createEtherscanLinkMarkdown(event.proposer, this.contractProps.networkId) +
        ` proposed a price for the request made by ${event.requester} at the timestamp ${event.timestamp} for the identifier: ${event.identifier}. ` +
        `The proposal price of ${event.proposedPrice} will expire at ${event.expirationTimestamp}. ` +
        `The ancillary data field is ${event.ancillaryData}. ` +
        `Collateral currency address is ${event.currency}. ` +
        `tx: ${createEtherscanLinkMarkdown(event.transactionHash, this.contractProps.networkId)}`;

      this.logger[this.logOverrides.proposedPrice || "error"]({
        at: "OptimisticOracleContractMonitor",
        message: "Price Proposal Alert 🧞‍♂️!",
        mrkdwn: mrkdwn
      });
    }
    this.lastProposePriceBlockNumber = this._getLastSeenBlockNumber(latestEvents);
  }

  // Queries DisputePrice events since the latest query marked by `lastDisputePriceBlockNumber`.
  async checkForDisputes() {
    this.logger.debug({
      at: "OptimisticOracleContractMonitor",
      message: "Checking for DisputePrice events",
      lastDisputePriceBlockNumber: this.lastDisputePriceBlockNumber
    });

    let latestEvents = this.optimisticOracleContractEventClient.getAllDisputePriceEvents();

    // Get events that are newer than the last block number we've seen
    latestEvents = latestEvents.filter(event => event.blockNumber > this.lastDisputePriceBlockNumber);

    for (let event of latestEvents) {
      const mrkdwn =
        createEtherscanLinkMarkdown(event.disputer, this.contractProps.networkId) +
        ` disputed a price for the request made by ${event.requester} at the timestamp ${event.timestamp} for the identifier: ${event.identifier}. ` +
        `The proposer ${event.proposer} proposed a price of ${event.proposedPrice}. ` +
        `The ancillary data field is ${event.ancillaryData}. ` +
        `tx: ${createEtherscanLinkMarkdown(event.transactionHash, this.contractProps.networkId)}`;

      this.logger[this.logOverrides.disputedPrice || "error"]({
        at: "OptimisticOracleContractMonitor",
        message: "Price Dispute Alert ⛔️!",
        mrkdwn: mrkdwn
      });
    }
    this.lastDisputePriceBlockNumber = this._getLastSeenBlockNumber(latestEvents);
  }

  // Queries Settle events since the latest query marked by `lastSettlementBlockNumber`.
  async checkForSettlements() {
    this.logger.debug({
      at: "OptimisticOracleContractMonitor",
      message: "Checking for Settle events",
      lastSettlementBlockNumber: this.lastSettlementBlockNumber
    });

    let latestEvents = this.optimisticOracleContractEventClient.getAllSettlementEvents();

    // Get events that are newer than the last block number we've seen
    latestEvents = latestEvents.filter(event => event.blockNumber > this.lastSettlementBlockNumber);

    for (let event of latestEvents) {
      const mrkdwn =
        `Detected a price request settlement for the request made by ${event.requester} at the timestamp ${event.timestamp} for the identifier: ${event.identifier}. ` +
        `The proposer was ${event.proposer} and the disputer was ${event.disputer}. ` +
        `The settlement price is ${event.price}. ` +
        `The payout was ${event.payout} made to the ${
          event.disputer === ZERO_ADDRESS ? "proposer" : "winner of the dispute"
        }. ` +
        `The ancillary data field is ${event.ancillaryData}. ` +
        `tx: ${createEtherscanLinkMarkdown(event.transactionHash, this.contractProps.networkId)}`;

      this.logger[this.logOverrides.settledPrice || "info"]({
        at: "OptimisticOracleContractMonitor",
        message: "Price Settlement Alert 🏧!",
        mrkdwn: mrkdwn
      });
    }
    this.lastSettlementBlockNumber = this._getLastSeenBlockNumber(latestEvents);
  }

  _getLastSeenBlockNumber(eventArray) {
    if (eventArray.length == 0) {
      return 0;
    }
    return eventArray[eventArray.length - 1].blockNumber;
  }
}

module.exports = {
  OptimisticOracleContractMonitor
};
