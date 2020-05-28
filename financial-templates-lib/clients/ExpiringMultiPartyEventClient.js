// A thick client for getting information about an ExpiringMultiParty events. This client is kept separate from the
// ExpiringMultiPartyClient to keep a clear separation of concerns and to limit the overhead from querying chain
// necessarily.// If no updateThreshold is specified then default to updating every 60 seconds.
class ExpiringMultiPartyEventClient {
  constructor(logger, empAbi, web3, empAddress, latestBlockNumber = 0) {
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
    this.depositEvents = [];
    this.createEvents = [];
    this.withdrawEvents = [];
    this.redeemEvents = [];
    this.regularFeeEvents = [];
    this.finalFeeEvents = [];

    // First block number to begin searching for events after.
    this.firstBlockToSearch = latestBlockNumber;
    this.lastUpdateTimestamp = 0;
  }
  // Delete all events within the client
  clearState = async () => {
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];
    this.newSponsorEvents = [];
    this.depositEvents = [];
    this.createEvents = [];
    this.withdrawEvents = [];
    this.redeemEvents = [];
    this.regularFeeEvents = [];
    this.finalFeeEvents = [];
  };

  getAllNewSponsorEvents = () => this.newSponsorEvents;

  getAllLiquidationEvents = () => this.liquidationEvents;

  getAllDisputeEvents = () => this.disputeEvents;

  getAllDisputeSettlementEvents = () => this.disputeSettlementEvents;

  getAllDepositEvents = () => this.depositEvents;

  getAllCreateEvents = () => this.createEvents;

  getAllWithdrawEvents = () => this.withdrawEvents;

  getAllRedeemEvents = () => this.redeemEvents;

  getAllRegularFeeEvents = () => this.regularFeeEvents;

  getAllFinalFeeEvents = () => this.finalFeeEvents;

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

    // Create events
    const createEventsObj = await this.emp.getPastEvents("PositionCreated", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of createEventsObj) {
      this.createEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount,
        tokenAmount: event.returnValues.tokenAmount
      });
    }

    // NewSponsor events mapped against PositionCreated events to determine size of new positions created.
    const newSponsorEventsObj = await this.emp.getPastEvents("NewSponsor", {
      fromBlock: this.firstBlockToSearch,
      toBlock: currentBlockNumber
    });
    for (let event of newSponsorEventsObj) {
      // Every transaction that emits a NewSponsor event must also emit a PositionCreated event.
      // We assume that there is only one PositionCreated event that has the same block number as
      // the current NewSponsor event.
      const createEvent = this.createEvents.filter(e => e.blockNumber === event.blockNumber);

      this.newSponsorEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: createEvent[0].collateralAmount,
        tokenAmount: createEvent[0].tokenAmount
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
