// A thick client for getting information about an ExpiringMultiParty events. This client is kept separate from the
// ExpiringMultiPartyClient to keep a clear separation of concerns and to limit the overhead from querying the chain.

class ExpiringMultiPartyEventClient {
  /**
   * @notice Constructs new ExpiringMultiPartyClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} empAbi Expiring Multi Party truffle ABI object to create a contract instance.
   * @param {Object} web3 Web3 provider from truffle instance.
   * @param {String} empAddress Ethereum address of the EMP contract deployed on the current network.
   * @param {Integer} startingBlockNumber Offset block number to index events from.
   * @param {Integer} endingBlockNumber Termination block number to index events until. If not defined runs to `latest`.
   * @return None or throws an Error.
   */
  constructor(logger, empAbi, web3, empAddress, startingBlockNumber = 0, endingBlockNumber = null) {
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
    this.liquidationWithdrawnEvents = [];
    this.settleExpiredPositionEvents = [];

    // First block number to begin searching for events after.
    this.firstBlockToSearch = startingBlockNumber;

    // Last block number to end the searching for events at.
    this.lastBlockToSearchUntil = endingBlockNumber;
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
    this.liquidationWithdrawnEvents = [];
    this.settleExpiredPositionEvents = [];
  };

  getAllNewSponsorEvents() {
    return this.newSponsorEvents;
  }

  getAllLiquidationEvents() {
    return this.liquidationEvents;
  }

  getAllDisputeEvents() {
    return this.disputeEvents;
  }

  getAllDisputeSettlementEvents() {
    return this.disputeSettlementEvents;
  }

  getAllDepositEvents() {
    return this.depositEvents;
  }

  getAllCreateEvents() {
    return this.createEvents;
  }

  getAllWithdrawEvents() {
    return this.withdrawEvents;
  }

  getAllRedeemEvents() {
    return this.redeemEvents;
  }

  getAllRegularFeeEvents() {
    return this.regularFeeEvents;
  }

  getAllFinalFeeEvents() {
    return this.finalFeeEvents;
  }

  getAllLiquidationWithdrawnEvents() {
    return this.liquidationWithdrawnEvents;
  }

  getAllSettleExpiredPositionEvents() {
    return this.settleExpiredPositionEvents;
  }

  // Returns the last update timestamp.
  getLastUpdateTime() {
    return this.lastUpdateTimestamp;
  }

  async update() {
    // The last block to search is either the value specified in the constructor (useful in serverless mode) or is the
    // latest block number (if running in loop mode).
    // Set the last block to search up until.
    const lastBlockToSearch = this.lastBlockToSearchUntil
      ? this.lastBlockToSearchUntil
      : await this.web3.eth.getBlockNumber();

    // Define a config to bound the queries by.
    const blockSearchConfig = {
      fromBlock: this.firstBlockToSearch,
      toBlock: lastBlockToSearch
    };

    // Look for events on chain from the previous seen block number to the current block number.
    const [
      currentTime,
      liquidationEventsObj,
      disputeEventsObj,
      disputeSettlementEventsObj,
      createEventsObj,
      newSponsorEventsObj,
      depositEventsObj,
      withdrawEventsObj,
      redeemEventsObj,
      regularFeeEventsObj,
      finalFeeEventsObj,
      liquidationWithdrawnEventsObj,
      settleExpiredPositionEventsObj
    ] = await Promise.all([
      this.emp.methods.getCurrentTime().call(),
      this.emp.getPastEvents("LiquidationCreated", blockSearchConfig),
      this.emp.getPastEvents("LiquidationDisputed", blockSearchConfig),
      this.emp.getPastEvents("DisputeSettled", blockSearchConfig),
      this.emp.getPastEvents("PositionCreated", blockSearchConfig),
      this.emp.getPastEvents("NewSponsor", blockSearchConfig),
      this.emp.getPastEvents("Deposit", blockSearchConfig),
      this.emp.getPastEvents("Withdrawal", blockSearchConfig),
      this.emp.getPastEvents("Redeem", blockSearchConfig),
      this.emp.getPastEvents("RegularFeesPaid", blockSearchConfig),
      this.emp.getPastEvents("FinalFeesPaid", blockSearchConfig),
      this.emp.getPastEvents("LiquidationWithdrawn", blockSearchConfig),
      this.emp.getPastEvents("SettleExpiredPosition", blockSearchConfig)
    ]);
    // Set the current contract time as the last update timestamp from the contract.
    this.lastUpdateTimestamp = currentTime;

    // Process the responses into clean objects.
    // Liquidation events.
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

    // Dispute events.
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

    // Dispute settlement events.
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

    // Create events.
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

    // Deposit events.
    for (let event of depositEventsObj) {
      this.depositEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount
      });
    }

    // Withdraw events.
    for (let event of withdrawEventsObj) {
      this.withdrawEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount
      });
    }

    // Redeem events.
    for (let event of redeemEventsObj) {
      this.redeemEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        sponsor: event.returnValues.sponsor,
        collateralAmount: event.returnValues.collateralAmount,
        tokenAmount: event.returnValues.tokenAmount
      });
    }

    // Regular fee events.
    for (let event of regularFeeEventsObj) {
      this.regularFeeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        regularFee: event.returnValues.regularFee,
        lateFee: event.returnValues.lateFee
      });
    }

    // Final fee events.
    for (let event of finalFeeEventsObj) {
      this.finalFeeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        amount: event.returnValues.amount
      });
    }

    // Liquidation withdrawn events.
    for (let event of liquidationWithdrawnEventsObj) {
      this.liquidationWithdrawnEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        withdrawalAmount: event.returnValues.withdrawalAmount,
        liquidationStatus: event.returnValues.liquidationStatus
      });
    }

    // Settle expired position events.
    for (let event of settleExpiredPositionEventsObj) {
      this.settleExpiredPositionEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        caller: event.returnValues.caller,
        collateralReturned: event.returnValues.collateralReturned,
        tokensBurned: event.returnValues.tokensBurned
      });
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = lastBlockToSearch + 1;

    this.logger.debug({
      at: "ExpiringMultiPartyEventClient",
      message: "Expiring multi party event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  }
}

module.exports = {
  ExpiringMultiPartyEventClient
};
