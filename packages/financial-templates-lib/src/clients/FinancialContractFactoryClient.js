// A thick client for getting information about FinancialContractFactory contracts.
const _ = require("lodash");

class FinancialContractFactoryClient {
  /**
   * @notice Constructs new FinancialContractFactoryClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} financialContractFactoryAbi ExpiringMultiPartyCreator or PerpetualMultiPartyCreator truffle ABI object.
   * @param {Object} web3 Web3 provider from truffle instance.
   * @param {String} financialContractFactoryAddress Ethereum address of the factory contract deployed on the current network.
   * @param {Integer} startingBlockNumber Offset block number to index events from.
   * @param {Integer} endingBlockNumber Termination block number to index events until. If not defined runs to `latest`.
   * @return None or throws an Error.
   */
  constructor(
    logger,
    financialContractFactoryAbi,
    web3,
    financialContractFactoryAddress,
    startingBlockNumber = 0,
    endingBlockNumber = null,
    contractType = "PerpetualCreator"
    // Default to PerpetualMultiParty for now since the first intended user is the funding rate proposer bot.
  ) {
    this.logger = logger;
    this.web3 = web3;

    // Factory contract
    this.financialContractFactory = new this.web3.eth.Contract(
      financialContractFactoryAbi,
      financialContractFactoryAddress
    );
    this.financialContractFactoryAddress = financialContractFactoryAddress;

    // Factory Contract Events data structure to enable synchronous retrieval of information.
    this.createdContractEvents = [];

    // First block number to begin searching for events after.
    this.firstBlockToSearch = startingBlockNumber;

    // Last block number to end the searching for events at.
    this.lastBlockToSearchUntil = endingBlockNumber;
    this.lastUpdateTimestamp = 0;

    if (contractType !== "ExpiringMultiPartyCreator" && contractType !== "PerpetualCreator")
      throw new Error(
        `Invalid contract type provided: ${contractType}! The financial product factory client only supports ExpiringMultiPartyCreator or PerpetualCreator`
      );
    this.contractType = contractType;
  }
  // Delete all events within the client
  async clearState() {
    this.createdContractEvents = [];
  }

  getContractType() {
    return this.contractType;
  }

  getAllCreatedContractEvents() {
    return this.createdContractEvents;
  }

  getAllCreatedContractAddresses() {
    return _.uniq(this.createdContractEvents.map(event => event.contractAddress));
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
    const eventToSearchFor =
      this.contractType === "PerpetualCreator" ? "CreatedPerpetual" : "CreatedExpiringMultiParty";
    const [currentTime, createdContractEventsObj] = await Promise.all([
      this.financialContractFactory.methods.getCurrentTime().call(),
      this.financialContractFactory.getPastEvents(eventToSearchFor, blockSearchConfig)
    ]);
    // Set the current contract time as the last update timestamp from the contract.
    this.lastUpdateTimestamp = currentTime;

    // Process the responses into clean objects.
    for (let event of createdContractEventsObj) {
      const createdAddress =
        this.contractType === "PerpetualCreator"
          ? event.returnValues.perpetualAddress
          : event.returnValues.expiringMultiPartyAddress;
      this.createdContractEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        deployerAddress: event.returnValues.deployerAddress,
        contractAddress: createdAddress
      });
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = lastBlockToSearch + 1;

    this.logger.debug({
      at: "FinancialContractFactoryClient",
      message: "Financial Contract Factory event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  }
}

module.exports = {
  FinancialContractFactoryClient
};
