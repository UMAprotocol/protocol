// This notifier is used to monitor and compare Optimistic Oracle contract proposals against the Polymarket API endpoint.

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();
const abi = require("./abi/abi");
const { getAddress, getAbi } = require("@uma/contracts-node");
const { TransactionDataDecoder, aggregateTransactionsAndCall } = require("@uma/financial-templates-lib");
const { MIN_INT_VALUE } = require("@uma/common");

const polymarketContract = "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130";
const multicallAddress = "0x11ce4B23bD875D7F5C6a31084f55fDe1e9A87507";

class PolymarketNotifier {
  /**
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {String} apiEndpoint API endpoint to monitor.
   * @param {Integer} maxTimeAfterProposal Period in seconds to look for past proposals.
   * @param {Integer} minAcceptedPrice API price that determines if alert is sent.
   */
  constructor({ logger, web3, networker, getTime, apiEndpoint, maxTimeAfterProposal, minAcceptedPrice }) {
    this.logger = logger;
    this.web3 = web3;
    this.networker = networker;
    this.getTime = getTime;
    this.apiEndpoint = apiEndpoint;
    this.maxTimeAfterProposal = maxTimeAfterProposal;
    this.minAcceptedPrice = minAcceptedPrice;
    // Manually add polymarket abi to the abi decoder global so aggregateTransactionsAndCall will return the correctly decoded data.
    TransactionDataDecoder.getInstance().abiDecoder.addABI(abi);
  }

  // Main function to check recent proposals against Polymarket API data.
  async checkRecentProposals() {
    this.logger.debug({
      at: "PolymarketNotifier",
      message: "Checking for past proposals",
      apiEndpoint: this.apiEndpoint,
      maxTimeAfterProposal: this.maxTimeAfterProposal,
      minAcceptedPrice: this.minAcceptedPrice,
    });
    const currentTime = await this.getTime();
    const notifiedProposals = await this.getNotifiedProposals();
    const questionData = await this.getQuestionData();

    // gets the most updated OO contract
    const optimisticOracleAddress = await getAddress("OptimisticOracle", 137);
    const optimisticOracleAbi = await getAbi("OptimisticOracle");
    const contract = await new this.web3.eth.Contract(optimisticOracleAbi, optimisticOracleAddress);

    // gets all ProposePrice events using ethers query filter api
    const events = await contract.getPastEvents("ProposePrice", { fromBlock: 0 });

    // creates array for each event
    const proposalEvents = events.map((request) => ({
      txHash: request.transactionHash,
      requester: request.returnValues["requester"],
      proposer: request.returnValues["proposer"],
      timestamp: Number(request.returnValues["timestamp"]),
      identifier: request.returnValues["identifier"],
      ancillaryData: request.returnValues["ancillaryData"],
      proposedPrice: this.web3.utils.fromWei(request.returnValues["proposedPrice"]).toString(),
    }));

    // combines data from the Polymarket API data to the proposal event based on ancillaryData
    const proposalData = proposalEvents
      .filter((proposalEvent) => proposalEvent.timestamp > currentTime - this.maxTimeAfterProposal)
      .map((proposalEvent) => ({
        ...proposalEvent,
        ...questionData.find((proposals) => proposals.ancillaryData === proposalEvent.ancillaryData),
      }));

    // checks the proposed price against the Polymarket API data
    const recentProposals = proposalData
      .map((contract) => {
        // excluding proposals without a proposed price and the requester is not Polymarket
        // the threshold for accepting a proposal is valid is currently set to 0.95 but can be adjusted
        if (!contract.timestamp || !contract.proposedPrice || contract.requester != polymarketContract) {
          return null;
        }
        // ensures the API price is greater than 0.95 when a 1 is proposed
        if (contract.proposedPrice === "1" && contract.outcome1Price > this.minAcceptedPrice) {
          return null;
        }
        // ensures the API price is greater than 0.95 when a 1 is proposed
        if (contract.proposedPrice === "0" && contract.outcome2Price > this.minAcceptedPrice) {
          return null;
        }
        // the bot currently is not optimized for earlyExpirations but can be updated later
        if (contract.proposedPrice === this.web3.utils.fromWei(MIN_INT_VALUE)) return null;

        const expirationUtcString = new Date(contract.timestamp * 1000).toUTCString();

        return {
          chainId: 137,
          txHash: contract.txHash,
          question: contract.question,
          requester: contract.requester,
          identifier: contract.identifier,
          ancillaryData: contract.ancillaryData,
          proposedPrice: contract.proposedPrice,
          proposeTimestamp: contract.timestamp,
          outcome1: contract.outcome1,
          outcome1Price: contract.outcome1Price,
          outcome2: contract.outcome2,
          outcome2Price: contract.outcome2Price,
          expirationUtcString: expirationUtcString,
        };
      })
      .filter((contract) => {
        return (
          contract &&
          // Include only contracts that expire within maxTimeAfterProposal seconds.
          contract.proposeTimestamp >= currentTime - this.maxTimeAfterProposal &&
          // Filter out proposals that have already been notified
          !Object.keys(notifiedProposals).includes(
            contract.txHash + "_" + contract.question + "_" + contract.proposedPrice
          )
        );
      });

    let mrkdwn = "The following proposal is different than the Polymarket API price:";
    for (let contract of recentProposals) {
      mrkdwn =
        mrkdwn +
        `\n- A price of ${contract.proposedPrice} was proposed at ${contract.expirationUtcString} for the following question:` +
        `\n- ${contract.question}` +
        `\n- The Polymarket API reports prices of ${contract.outcome1}:${contract.outcome1Price} and ${contract.outcome2}:${contract.outcome2Price}` +
        "\n-" +
        this._generateUILink(contract.txHash, contract.chainId);
    }
    if (recentProposals.length) {
      this.logger.error({
        at: "PolymarketNotifier",
        message: "Difference between proposed price and Polymarket API!🚨",
        mrkdwn,
        notificationPath: "polymarket-notifier",
      });
    }
    // Update google datastore on notified proposals.
    await this.updateNotifiedProposals(recentProposals, currentTime);
  }

  // gets Polymarket API data that can be used to compare against proposals
  async getQuestionData() {
    const polymarketConditionalContract = await new this.web3.eth.Contract(abi, polymarketContract);

    // Polymarket API
    const apiUrl = this.apiEndpoint + "?_limit=-1&active=true&closed=false&_sort=created_at:desc";
    const polymarketContracts = await this.networker.getJson(apiUrl, { method: "get" });

    const transactions = polymarketContracts.map((polymarketContract) => ({
      target: polymarketConditionalContract.options.address,
      callData: polymarketConditionalContract.methods.questions(polymarketContract.questionID).encodeABI(),
    }));

    // Since the Polymarket API doesn't have ancillaryData included, calls questions method using questionId as argument to link PM and event data
    const ancillaryData = (await aggregateTransactionsAndCall(multicallAddress, this.web3, transactions)).map(
      ({ ancillaryData }, i) => {
        const { questionID, question, outcomes, outcomePrices } = polymarketContracts[i];
        return {
          questionID,
          question,
          ancillaryData,
          outcome1: outcomes[0],
          outcome1Price: Number(outcomePrices[0]).toFixed(4),
          outcome2: outcomes[1],
          outcome2Price: Number(outcomePrices[1]).toFixed(4),
        };
      }
    );

    return ancillaryData;
  }

  // Gets previously notified contracts from google Datastore.
  async getNotifiedProposals() {
    const notifiedProposals = (await datastore.runQuery(datastore.createQuery("NotifiedProposals")))[0];
    return notifiedProposals.reduce((contracts, contract) => {
      return {
        ...contracts,
        [contract.txHash + "_" + contract.question + "_" + contract.proposedPrice]: {
          txHash: contract.txHash,
          question: contract.question,
          proposedPrice: contract.proposedPrice,
          notificationTimestamp: contract.notificationTimestamp,
        },
      };
    }, {});
  }

  // Adds notified contracts to google Datastore.
  async updateNotifiedProposals(notifiedContracts, currentTime) {
    const promises = notifiedContracts.map((contract) => {
      const key = datastore.key([
        "NotifiedProposals",
        contract.txHash + "_" + contract.question + "_" + contract.proposedPrice,
      ]);
      const data = {
        txHash: contract.txHash,
        question: contract.question,
        proposedPrice: contract.proposedPrice,
        notificationTimestamp: currentTime,
      };
      datastore.save({ key: key, data: data });
    });
    await Promise.all(promises);
  }

  _generateUILink(transactionHash, chainId) {
    return `<https://oracle.umaproject.org/request?transactionHash=${transactionHash}&chainId=${chainId} | View in the Oracle UI.>`;
  }
}

module.exports = { PolymarketNotifier };
