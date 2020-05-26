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
    this.newSponsorEvents = [];

    // First block number to begin searching for events after.
    this.firstBlockToSearch = 0;
    this.lastUpdateTimestamp = 0;
  }
  // Delete all events within the client
  clearState = async () => {
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];
    this.newSponsorEvents = [];
  };

  // Returns an array of new sponsor events.
  getAllNewSponsorEvents = () => this.newSponsorEvents;

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
      fromBlock: this.firstBlockToSearch,
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
      fromBlock: this.firstBlockToSearch,
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
      fromBlock: this.firstBlockToSearch,
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

    // NewSponsor events mapped against PositionCreated events to determine size of new positions created.
    const newSponsorEventsObj = await this.emp.getPastEvents("NewSponsor", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of newSponsorEventsObj) {
      // Every transaction that emits a NewSponsor event must also emit a PositionCreated event.
      const positionCreatedEventObj = await this.emp.getPastEvents("PositionCreated", {
        fromBlock: event.blockNumber,
        toBlock: event.blockNumber
      });

      this.newSponsorEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: positionCreatedEventObj[0].returnValues.collateralAmount,
        tokenAmount: positionCreatedEventObj[0].returnValues.tokenAmount
      });
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = currentBlockNumber + 1;

    this.lastUpdateTimestamp = await this.emp.methods.getCurrentTime().call();
    this.logger.debug({
      at: "ExpiringMultiPartyEventClient",
      message: "Expiring multi party event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  };
}

module.exports = {
  ExpiringMultiPartyEventClient
};
