// Note: This client should normally live in the `financial-templates-lib` package, but it requires access to
// contract ABI's that are not available in the currently fixed version of @uma/core (1.2). Therefore,
// this file must remain in this isolated package which uses @uma/core@latest until `financial-templates-lib`
// is on latest.

// A thick client for getting information about an OptimisticOracle. Used to get price requests and
// proposals, which can be disputed and settled.
const { OptimisticOracleRequestStatesEnum } = require("@uma/common");
const Promise = require("bluebird");

class OptimisticOracleClient {
  /**
   * @notice Constructs new OptimisticOracleClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} oracleAbi OptimisticOracle truffle ABI object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} oracleAddress Ethereum address of the OptimisticOracle contract deployed on the current network.
   * @return None or throws an Error.
   */
  constructor(logger, oracleAbi, web3, oracleAddress) {
    this.logger = logger;
    this.web3 = web3;

    // Oracle contract
    this.oracle = new web3.eth.Contract(oracleAbi, oracleAddress);
    this.oracleAddress = oracleAddress;

    // Oracle Data structures & values to enable synchronous returns of the state seen by the client.
    this.priceRequests = [];
    this.priceProposals = [];

    // Store the last on-chain time the clients were updated to inform price request information.
    this.lastUpdateTimestamp = 0;

    // Helper functions from web3.
    this.hexToUtf8 = this.web3.utils.hexToUtf8;
  }

  // Returns an array of Price Request objects that have no proposals yet.
  getAllPriceRequests() {
    return this.priceRequests;
  }

  // Returns an array of Price Request objects that someone has proposed a price for.
  getAllPriceProposals() {
    return this.priceProposals;
  }

  // Returns an array of Price Request objects for each position that someone has proposed a price for and whose
  // proposal can be disputed. The proposal can be disputed because the proposed price deviates from the `inputPrice` by
  // more than the `errorThreshold`.
  getDisputablePriceProposals() {
    // TODO
    return;
  }

  // Returns the last update timestamp.
  getLastUpdateTime() {
    return this.lastUpdateTimestamp;
  }

  async update() {
    // Fetch contract state variables in parallel.
    const [requestEvents, currentTime] = await Promise.all([
      this.oracle.getPastEvents("RequestPrice", { fromBlock: 0 }), // TODO: Change this `fromBlock` to something > 0
      this.oracle.methods.getCurrentTime().call()
    ]);

    // Fetch request states in parallel batches, 20 at a time, to be safe and not overload the web3 node.
    const WEB3_CALLS_BATCH_SIZE = 150;

    const [requestStates] = await Promise.all([
      Promise.map(
        requestEvents,
        request =>
          this.oracle.methods
            .getState(
              request.returnValues.requester,
              request.returnValues.identifier,
              request.returnValues.timestamp,
              request.returnValues.ancillaryData ? request.returnValues.ancillaryData : "0x"
            )
            .call(),
        {
          concurrency: WEB3_CALLS_BATCH_SIZE
        }
      )
    ]);

    // Sort price requests based on state.
    requestStates.map((state, index) => {
      let requestData = {
        requester: requestEvents[index].returnValues.requester,
        identifier: this.hexToUtf8(requestEvents[index].returnValues.identifier),
        timestamp: requestEvents[index].returnValues.timestamp,
        currency: requestEvents[index].returnValues.currency,
        reward: requestEvents[index].returnValues.reward,
        finalFee: requestEvents[index].returnValues.finalFee
      };
      if (state === OptimisticOracleRequestStatesEnum.REQUESTED) {
        this.priceRequests.push(requestData);
      } else if (state === OptimisticOracleRequestStatesEnum.PROPOSED) {
        // TODO: Add data specific for proposals,
        // or alternatively search for ProposedPrice events.
        this.priceProposals.push(requestData);
      }
    });

    this.lastUpdateTimestamp = currentTime;
    this.logger.debug({
      at: "OptimisticOracleClient",
      message: "Optimistic Oracle state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  }
}

module.exports = {
  OptimisticOracleClient
};
