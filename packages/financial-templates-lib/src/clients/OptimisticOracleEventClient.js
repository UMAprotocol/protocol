// A thick client for getting information about OptimisticOracle events. This client is kept separate from the
// OptimisticOracleClient to keep a clear separation of concerns and to limit the overhead from querying the chain.

class OptimisticOracleEventClient {
  /**
   * @notice Constructs new OptimisticOracleEventClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} optimisticOracleAbi OptimisticOracle truffle ABI object to create a contract instance.
   * @param {Object} web3 Web3 provider from truffle instance.
   * @param {String} optimisticOracleAddress Ethereum address of the OptimisticOracle contract deployed on the current network.
   * @param {Integer} startingBlockNumber Offset block number to index events from.
   * @param {Integer} endingBlockNumber Termination block number to index events until. If not defined runs to `latest`.
   * @return None or throws an Error.
   */
  constructor(
    logger,
    optimisticOracleAbi,
    web3,
    optimisticOracleAddress,
    startingBlockNumber = 0,
    endingBlockNumber = null
  ) {
    this.logger = logger;
    this.web3 = web3;

    // OptimisticOracle contract
    this.optimisticOracleContract = new this.web3.eth.Contract(optimisticOracleAbi, optimisticOracleAddress);
    this.optimisticOracleAddress = optimisticOracleAddress;

    // OptimisticOracle Contract Events data structure to enable synchronous retrieval of information.
    this.requestPriceEvents = [];
    this.proposePriceEvents = [];
    this.disputePriceEvents = [];
    this.settlementEvents = [];

    // First block number to begin searching for events after.
    this.firstBlockToSearch = startingBlockNumber;

    // Last block number to end the searching for events at.
    this.lastBlockToSearchUntil = endingBlockNumber;
    this.lastUpdateTimestamp = 0;

    this.hexToUtf8 = web3.utils.hexToUtf8;
  }
  // Delete all events within the client
  async clearState() {
    this.requestPriceEvents = [];
    this.proposePriceEvents = [];
    this.disputePriceEvents = [];
    this.settlementEvents = [];
  }

  getAllRequestPriceEvents() {
    return this.requestPriceEvents;
  }

  getAllProposePriceEvents() {
    return this.proposePriceEvents;
  }

  getAllDisputePriceEvents() {
    return this.disputePriceEvents;
  }

  getAllSettlementEvents() {
    return this.settlementEvents;
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
      requestPriceEventsObj,
      proposePriceEventsObj,
      disputePriceEventsObj,
      settlementEventsObj
    ] = await Promise.all([
      this.optimisticOracleContract.methods.getCurrentTime().call(),
      this.optimisticOracleContract.getPastEvents("RequestPrice", blockSearchConfig),
      this.optimisticOracleContract.getPastEvents("ProposePrice", blockSearchConfig),
      this.optimisticOracleContract.getPastEvents("DisputePrice", blockSearchConfig),
      this.optimisticOracleContract.getPastEvents("Settle", blockSearchConfig)
    ]);
    // Set the current contract time as the last update timestamp from the contract.
    this.lastUpdateTimestamp = currentTime;

    // Process the responses into clean objects.
    // RequestPrice events.
    for (let event of requestPriceEventsObj) {
      this.requestPriceEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        requester: event.returnValues.requester,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        timestamp: event.returnValues.timestamp,
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
        currency: event.returnValues.currency,
        reward: event.returnValues.reward,
        finalFee: event.returnValues.finalFee
      });
    }

    // ProposePrice events.
    for (let event of proposePriceEventsObj) {
      this.proposePriceEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        requester: event.returnValues.requester,
        proposer: event.returnValues.proposer,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        timestamp: event.returnValues.timestamp,
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
        proposedPrice: event.returnValues.proposedPrice,
        expirationTimestamp: event.returnValues.expirationTimestamp,
        currency: event.returnValues.currency
      });
    }

    // DisputePrice events.
    for (let event of disputePriceEventsObj) {
      this.disputePriceEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        requester: event.returnValues.requester,
        proposer: event.returnValues.proposer,
        disputer: event.returnValues.disputer,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        timestamp: event.returnValues.timestamp,
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
        proposedPrice: event.returnValues.proposedPrice
      });
    }

    // Settlement events.
    for (let event of settlementEventsObj) {
      this.settlementEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        requester: event.returnValues.requester,
        proposer: event.returnValues.proposer,
        disputer: event.returnValues.disputer,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        timestamp: event.returnValues.timestamp,
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
        price: event.returnValues.price,
        payout: event.returnValues.payout
      });
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = lastBlockToSearch + 1;

    this.logger.debug({
      at: "OptimisticOracleEventClient",
      message: "Optimistic Oracle event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  }
}

module.exports = {
  OptimisticOracleEventClient
};
