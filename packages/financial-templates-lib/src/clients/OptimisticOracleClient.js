// A thick client for getting information about an OptimisticOracle. Used to get price requests and
// proposals, which can be disputed and settled.
const { averageBlockTimeSeconds } = require("@uma/common");
const Promise = require("bluebird");

class OptimisticOracleClient {
  /**
   * @notice Constructs new OptimisticOracleClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} oracleAbi OptimisticOracle truffle ABI object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} oracleAddress Ethereum address of the OptimisticOracle contract deployed on the current network.
   * @param {Number} lookback Any requests, proposals, or disputes that occurred prior to this timestamp will be ignored.
   * Used to limit the web3 requests made by this client.
   * @return None or throws an Error.
   */
  constructor(
    logger,
    oracleAbi,
    web3,
    oracleAddress,
    lookback = 604800 // 1 Week
  ) {
    this.logger = logger;
    this.web3 = web3;

    // Oracle contract
    this.oracle = new web3.eth.Contract(oracleAbi, oracleAddress);
    this.oracleAddress = oracleAddress;

    // Oracle Data structures & values to enable synchronous returns of the state seen by the client.
    this.unproposedPriceRequests = [];
    this.undisputedProposals = [];
    this.expiredProposals = [];
    this.settleableDisputes = [];

    // Store the last on-chain time the clients were updated to inform price request information.
    this.lastUpdateTimestamp = 0;
    this.lookback = lookback;

    // Helper functions from web3.
    this.hexToUtf8 = this.web3.utils.hexToUtf8;
  }

  // Returns an array of Price Requests that have no proposals yet.
  getUnproposedPriceRequests() {
    return this.unproposedPriceRequests;
  }

  // Returns an array of Price Proposals that have not been disputed.
  getUndisputedProposals() {
    return this.undisputedProposals;
  }

  // Returns an array of expired Price Proposals that can be settled
  getExpiredProposals() {
    return this.expiredProposals;
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

  _getPriceRequestKey(reqEvent) {
    return `${reqEvent.returnValues.requester}-${reqEvent.returnValues.identifier}-${reqEvent.returnValues.timestamp}-${reqEvent.returnValues.ancillaryData}`;
  }

  async update() {
    // Determine earliest block to query events for based on lookback window:
    const [averageBlockTime, currentBlock] = await Promise.all([
      averageBlockTimeSeconds(),
      this.web3.eth.getBlock("latest")
    ]);
    const lookbackBlocks = Math.ceil(this.lookback / averageBlockTime);
    const earliestBlockToQuery = Math.max(currentBlock.number - lookbackBlocks, 0);

    // Fetch contract state variables in parallel.
    const [requestEvents, proposalEvents, disputeEvents, currentTime] = await Promise.all([
      this.oracle.getPastEvents("RequestPrice", { fromBlock: earliestBlockToQuery }),
      this.oracle.getPastEvents("ProposePrice", { fromBlock: earliestBlockToQuery }),
      this.oracle.getPastEvents("DisputePrice", { fromBlock: earliestBlockToQuery }),
      this.oracle.methods.getCurrentTime().call()
    ]);

    // Store price requests that have NOT been proposed to yet:
    const unproposedPriceRequests = requestEvents.filter(event => {
      const key = this._getPriceRequestKey(event);
      const hasProposal = proposalEvents.find(proposalEvent => this._getPriceRequestKey(proposalEvent) === key);
      return hasProposal === undefined;
    });
    this.unproposedPriceRequests = unproposedPriceRequests.map(event => {
      return {
        requester: event.returnValues.requester,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        timestamp: event.returnValues.timestamp,
        currency: event.returnValues.currency,
        reward: event.returnValues.reward,
        finalFee: event.returnValues.finalFee
      };
    });

    // Store proposals that have NOT been disputed:
    let undisputedProposals = proposalEvents.filter(event => {
      const key = this._getPriceRequestKey(event);
      const hasDispute = disputeEvents.find(disputeEvent => this._getPriceRequestKey(disputeEvent) === key);
      return hasDispute === undefined;
    });
    undisputedProposals = undisputedProposals.map(event => {
      return {
        requester: event.returnValues.requester,
        proposer: event.returnValues.proposer,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        timestamp: event.returnValues.timestamp,
        proposedPrice: event.returnValues.proposedPrice,
        expirationTimestamp: event.returnValues.expirationTimestamp
      };
    });

    // Filter proposals based on their expiration timestamp:
    const isExpired = proposal => {
      return Number(proposal.expirationTimestamp) <= Number(currentTime);
    };
    this.expiredProposals = undisputedProposals.filter(proposal => isExpired(proposal));
    this.undisputedProposals = undisputedProposals.filter(proposal => !isExpired(proposal));

    // Store disputes that can be settled:
    // TODO: If we want to implement this method, then we need to make additional web3 calls
    // to check if the DVM has resolved each dispute. We might not even want to have the OO settle
    // any proposals/disputes.

    // TODO:
    // Determine which of the `undisputedProposals` can be disputed based on price feed information
    // and the proposal's `proposedPrice`.

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
