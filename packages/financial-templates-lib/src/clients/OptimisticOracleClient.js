// A thick client for getting information about an OptimisticOracle. Used to get price requests and
// proposals, which can be disputed and settled.
const { averageBlockTimeSeconds, revertWrapper, OptimisticOracleRequestStatesEnum } = require("@uma/common");
const Promise = require("bluebird");

class OptimisticOracleClient {
  /**
   * @notice Constructs new OptimisticOracleClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} oracleAbi OptimisticOracle truffle ABI object.
   * @param {Object} votingAbi Voting truffle ABI object.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} oracleAddress Ethereum address of the OptimisticOracle contract deployed on the current network.
   * @param {String} votingAddress Ethereum address of the Voting contract deployed on the current network.
   * @param {Number} lookback Any requests, proposals, or disputes that occurred prior to this timestamp will be ignored.
   * Used to limit the web3 requests made by this client.
   * @return None or throws an Error.
   */
  constructor(
    logger,
    oracleAbi,
    votingAbi,
    web3,
    oracleAddress,
    votingAddress,
    lookback = 604800 // 1 Week
  ) {
    this.logger = logger;
    this.web3 = web3;

    // Optimistic Oracle contract:
    this.oracle = new web3.eth.Contract(oracleAbi, oracleAddress);

    // Voting contract we'll use to determine whether OO disputes can be settled:
    this.voting = new web3.eth.Contract(votingAbi, votingAddress);

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

  // Returns an array of expired Price Proposals that can be settled and that involved
  // the caller as the proposer
  getSettleableProposals(caller) {
    return this.expiredProposals.filter(event => {
      return event.proposer === caller;
    });
  }

  // Returns disputes that can be settled and that involved the caller as the disputer
  getSettleableDisputes(caller) {
    return this.settleableDisputes.filter(event => {
      return event.disputer === caller;
    });
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
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
        timestamp: event.returnValues.timestamp,
        currency: event.returnValues.currency,
        reward: event.returnValues.reward,
        finalFee: event.returnValues.finalFee
      };
    });

    // Store proposals that have NOT been disputed and have NOT been settled, and reformat data.
    const undisputedProposals = proposalEvents.filter(event => {
      const key = this._getPriceRequestKey(event);
      const hasDispute = disputeEvents.find(disputeEvent => this._getPriceRequestKey(disputeEvent) === key);
      return hasDispute === undefined;
    });
    const unsettledProposals = await Promise.all(
      undisputedProposals.map(async event => {
        const state = await this.oracle.methods
          .getState(
            event.returnValues.requester,
            event.returnValues.identifier,
            event.returnValues.timestamp,
            event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x"
          )
          .call();

        // For unsettled proposals, reformat the data:
        if (state !== OptimisticOracleRequestStatesEnum.SETTLED) {
          return {
            requester: event.returnValues.requester,
            proposer: event.returnValues.proposer,
            identifier: this.hexToUtf8(event.returnValues.identifier),
            ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
            timestamp: event.returnValues.timestamp,
            proposedPrice: event.returnValues.proposedPrice,
            expirationTimestamp: event.returnValues.expirationTimestamp,
            currency: event.returnValues.currency
          };
        }
      })
    ).filter(event => event !== undefined);

    // Filter proposals based on their expiration timestamp:
    const isExpired = proposal => {
      return Number(proposal.expirationTimestamp) <= Number(currentTime);
    };
    this.expiredProposals = unsettledProposals.filter(proposal => isExpired(proposal));
    this.undisputedProposals = unsettledProposals.filter(proposal => !isExpired(proposal));

    // Store disputes that were resolved and can be settled:
    let resolvedDisputeEvents = await Promise.all(
      disputeEvents.map(async disputeEvent => {
        try {
          // When someone disputes an OO proposal, the OO requests a price to the DVM with a re-formatted
          // ancillary data packet that includes the original requester's information:
          const stampedAncillaryData = await this.oracle.methods
            .stampAncillaryData(
              disputeEvent.returnValues.ancillaryData ? disputeEvent.returnValues.ancillaryData : "0x",
              disputeEvent.returnValues.requester
            )
            .call();

          // getPrice will return null or revert if there is no price available,
          // in which case we'll ignore this dispute.
          let resolvedPrice = revertWrapper(
            await this.voting.methods
              .getPrice(disputeEvent.returnValues.identifier, disputeEvent.returnValues.timestamp, stampedAncillaryData)
              .call({
                from: this.oracle.options.address
              })
          );
          if (resolvedPrice !== null) {
            return disputeEvent;
          }
        } catch (error) {
          // No resolved price available, do nothing.
        }
      })
      // Remove undefined entries, marking disputes that did not have resolved prices
    ).filter(event => event !== undefined);

    // Filter out disputes that were already settled and reformat data.
    let unsettledResolvedDisputeEvents = await Promise.all(
      resolvedDisputeEvents.map(async event => {
        const state = await this.oracle.methods
          .getState(
            event.returnValues.requester,
            event.returnValues.identifier,
            event.returnValues.timestamp,
            event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x"
          )
          .call();

        // For unsettled disputes, reformat the data:
        if (state !== OptimisticOracleRequestStatesEnum.SETTLED) {
          return {
            requester: event.returnValues.requester,
            proposer: event.returnValues.proposer,
            disputer: event.returnValues.disputer,
            identifier: this.hexToUtf8(event.returnValues.identifier),
            ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
            timestamp: event.returnValues.timestamp
          };
        }
      })
    ).filter(event => event !== undefined);
    this.settleableDisputes = unsettledResolvedDisputeEvents;

    // Update timestamp and end update.
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
