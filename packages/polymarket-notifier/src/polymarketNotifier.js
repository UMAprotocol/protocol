// This notifier is used to monitor and compare Optimistic Oracle contract proposals against the Polymarket API endpoint.

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();
const abi = require("./abi/abi");
const Web3 = require("web3");
const ethers = require("ethers");
const uma = require("@uma/sdk");
const { getAddress } = require("@uma/contracts-node");

const web3 = new Web3(process.env.CUSTOM_NODE_URL);
const provider = new ethers.providers.WebSocketProvider(process.env.CUSTOM_NODE_URL);

const polymarketContract = "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130";
const earlyExpiryResponse = "-57896044618658097711785492504343953926634992332820282019728792003956564819968";

class PolymarketNotifier {
  /**
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {String} apiEndpoint API endpoint to monitor.
   * @param {Integer} maxTimeAfterProposal Period in seconds to look for past proposals.
   */
  constructor({ logger, networker, getTime, apiEndpoint, maxTimeAfterProposal }) {
    this.logger = logger;
    this.networker = networker;
    this.getTime = getTime;
    this.apiEndpoint = apiEndpoint;
    this.maxTimeAfterProposal = maxTimeAfterProposal;
  }

  // Main function to check recent proposals against Polymarket API data.
  async checkRecentProposals() {
    this.logger.debug({
      at: "PolymarketNotifier",
      message: "Checking for past proposals",
      apiEndpoint: this.apiEndpoint,
      maxTimeAfterProposal: this.maxTimeAfterProposal,
    });

    const proposalEvents = [];
    const proposalData = [];
    const currentTime = await this.getTime();
    const notifiedProposals = await this.getNotifiedProposals();
    const questionData = await this.getQuestionData();

    // gets the most updated OO contract
    const contractAddress = getAddress("OptimisticOracle", 137);
    const client = uma.clients.optimisticOracle.connect(contractAddress, provider);

    // gets all ProposePrice events using ethers query filter api
    const events = await client.queryFilter("ProposePrice");

    // creates array for each event
    events.forEach((request) =>
      proposalEvents.push({
        txHash: request.transactionHash,
        requester: request.args.requester,
        proposer: request.args.proposer,
        timestamp: Number(request.args.timestamp),
        identifier: request.args.identifier,
        ancillaryData: request.args.ancillaryData,
        proposedPrice: request.args.proposedPrice.toString(),
      })
    );

    // combines data from the Polymarket API data to the proposal event based on ancillaryData
    for (let i = 0; i < proposalEvents.length; i++) {
      if (proposalEvents[i].timestamp > currentTime - this.maxTimeAfterProposal) {
        proposalData.push({
          ...proposalEvents[i],
          ...questionData.find((proposalEvent) => proposalEvent.ancillaryData === proposalEvents[i].ancillaryData),
        });
      }
    }

    // checks the proposed price against the Polymarket API data
    const recentProposals = proposalData
      .map((contract) => {
        // excluding proposals without a proposed price and the requester is not Polymarket
        // the threshold for accepting a proposal is valid is currently set to 0.95 but can be adjusted
        if (!contract.timestamp || !contract.proposedPrice || contract.requester != polymarketContract) {
          return null;
        }
        // ensures the API price is greater than 0.95 when a 1 is proposed
        if (contract.proposedPrice === "1000000000000000000" && contract.outcome1Price > 0.95) {
          return null;
        }
        // ensures the API price is greater than 0.95 when a 1 is proposed
        if (contract.proposedPrice === "0" && contract.outcome2Price > 0.95) {
          return null;
        }
        // the bot currently is not optimized for earlyExpirations but can be updated later
        if (contract.proposedPrice === earlyExpiryResponse) {
          return null;
        }

        const expirationUtcString = new Date(contract.timestamp * 1000).toUTCString();

        return {
          chainId: 137,
          txHash: contract.txHash,
          question: contract.question,
          requester: contract.requester,
          identifier: contract.identifier,
          ancillaryData: contract.ancillaryData,
          proposedPrice: Number(ethers.utils.formatEther(contract.proposedPrice)),
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
        this._generateUILink(
          contract.requester,
          contract.identifier,
          contract.proposeTimestamp,
          contract.ancillaryData,
          contract.chainId
        );
    }
    if (recentProposals.length) {
      this.logger.warn({
        at: "ExpirationsNotifier",
        message: "Difference between proposed price and Polymarket API!",
        mrkdwn,
        notificationPath: "dev-x",
      });
    }
    // Update google datastore on notified proposals.
    await this.updateNotifiedProposals(recentProposals, currentTime);
  }

  // gets Polymarket API data that can be used to compare against proposals
  async getQuestionData() {
    const ancillaryData = [];
    const polymarketConditionalContract = await new web3.eth.Contract(abi, polymarketContract);

    // Polymarket API
    const apiUrl = this.apiEndpoint + "?_limit=750&active=true&_sort=created_at:desc";
    const polymarketContracts = await this.networker.getJson(apiUrl, { method: "get" });

    // Since the Polymarket API doesn't have ancillaryData included, calls questions method using questionId as argument to link PM and event data
    for (let i = 0; i < polymarketContracts.length; i++) {
      const ancillaryDataContract = await polymarketConditionalContract.methods
        .questions(polymarketContracts[i].questionID)
        .call();
      ancillaryData.push({
        questionID: polymarketContracts[i].questionID,
        question: polymarketContracts[i].question,
        ancillaryData: ancillaryDataContract.ancillaryData,
        outcome1: polymarketContracts[i].outcomes[0],
        outcome1Price: Number(polymarketContracts[i].outcomePrices[0]),
        outcome2: polymarketContracts[i].outcomes[1],
        outcome2Price: Number(polymarketContracts[i].outcomePrices[1]),
      });
    }
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

  _generateUILink(requester, identifier, timestamp, ancillaryData, chainId) {
    return `<https://oracle.umaproject.org/request?requester=${requester}&identifier=${identifier}&timestamp=${timestamp}&ancillaryData=${ancillaryData}&chainId=${chainId} | View in the Oracle UI.>`;
  }
}

module.exports = { PolymarketNotifier };
