// A thick client for getting information about an ExpiringMultiParty events. This client is kept separate from the
// ExpiringMultiPartyClient to keep a clear separation of concerns and to limit the overhead from querying chain
// necessarily.// If no updateThreshold is specified then default to updating every 60 seconds.
class ExpiringMultiPartyEventClient {
  constructor(logger, empAbi, web3, empAddress) {
    this.logger = logger;
    this.web3 = web3;

    // EMP contract
    this.emp = new this.web3.eth.Contract(empAbi, empAddress);
    this.empAddress = empAddress;

    // EMP Events data structure to enable synchronous retrieval of information.
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];

    // Last block number seen by the client.
    this.lastBlockNumberSeen = 0;
    this.lastUpdateTimestamp = 0;
  }
  // Delete all events within the client
  clearState = async () => {
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];
  };

  // Returns an array of liquidation events.
  getAllLiquidationEvents = () => this.liquidationEvents;

  // Returns an array of dispute events.
  getAllDisputeEvents = () => this.disputeEvents;

  // Returns an array of dispute events.
  getAllDisputeSettlementEvents = () => this.disputeSettlementEvents;

  // Returns the last update timestamp.
  getLastUpdateTime = () => this.lastUpdateTimestamp;

  update = async () => {
    const currentBlockNumber = await this.web3.eth.getBlockNumber();
    // Look for events on chain from the previous seen block number to the current block number.
    // Liquidation events
    const liquidationEventsObj = await this.emp.getPastEvents("LiquidationCreated", {
      fromBlock: this.lastBlockNumberSeen,
      toBlock: currentBlockNumber
    });

    for (let event of liquidationEventsObj) {
      this.liquidationEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        liquidationId: event.returnValues.liquidationId,
        tokensOutstanding: event.returnValues.tokensOutstanding,
        lockedCollateral: event.returnValues.lockedCollateral,
        liquidatedCollateral: event.returnValues.liquidatedCollateral
      });
    }

    // Dispute events
    const disputeEventsObj = await this.emp.getPastEvents("LiquidationDisputed", {
      fromBlock: this.lastBlockNumberSeen,
      toBlock: currentBlockNumber
    });
    for (let event of disputeEventsObj) {
      this.disputeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        disputer: event.returnValues.disputer,
        liquidationId: event.returnValues.liquidationId,
        disputeBondAmount: event.returnValues.disputeBondAmount
      });
    }

    // Dispute settlement events
    const disputeSettlementEventsObj = await this.emp.getPastEvents("DisputeSettled", {
      fromBlock: this.lastBlockNumberSeen,
      toBlock: currentBlockNumber
    });
    for (let event of disputeSettlementEventsObj) {
      this.disputeSettlementEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        sponsor: event.returnValues.sponsor,
        liquidator: event.returnValues.liquidator,
        disputer: event.returnValues.disputer,
        liquidationId: event.returnValues.liquidationId,
        disputeSucceeded: event.returnValues.disputeSucceeded
      });
    }
    this.lastBlockNumberSeen = currentBlockNumber;
    this.lastUpdateTimestamp = (await this.emp.methods.currentTime().call()).toNumber();
    this.logger.debug({
      at: "ExpiringMultiPartyClient",
      message: "Expiring multi party state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  };
}

module.exports = {
  ExpiringMultiPartyEventClient
};
