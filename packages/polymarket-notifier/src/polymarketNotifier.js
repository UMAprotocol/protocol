// This notifier is used to monitor and compare Optimistic Oracle contract proposals against the Polymarket API endpoint.

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();
const { binaryAdapterAbi, ctfAdapterAbi } = require("./abi/abi");
const { getAddress, getAbi } = require("@uma/contracts-node");
const { TransactionDataDecoder, aggregateTransactionsAndCall } = require("@uma/financial-templates-lib");
const { MIN_INT_VALUE } = require("@uma/common");
const { request } = require("graphql-request");
const assert = require("assert");

const binaryAdapterAddress = "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130";
const ctfAdapterAddress = "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74";
const multicallAddress = "0x11ce4B23bD875D7F5C6a31084f55fDe1e9A87507";

class PolymarketNotifier {
  /**
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {String} apiEndpoint API endpoint to monitor.
   * @param {String} graphqlEndpoint Graphql API endpoint to monitor.
   * @param {Integer} minAcceptedPrice API price that determines if alert is sent.
   * @param {Integer} minMarketLiquidity Minimum market liquidity that determines if alert is sent.
   * @param {Integer} minMarketVolume Minimum market volume that determines if alert is sent.
   */
  constructor({
    logger,
    web3,
    networker,
    getTime,
    apiEndpoint,
    graphqlEndpoint,
    minAcceptedPrice,
    minMarketLiquidity,
    minMarketVolume,
  }) {
    this.logger = logger;
    this.web3 = web3;
    this.networker = networker;
    this.getTime = getTime;
    this.apiEndpoint = apiEndpoint;
    this.graphqlEndpoint = graphqlEndpoint;
    this.minAcceptedPrice = minAcceptedPrice;
    this.minMarketLiquidity = minMarketLiquidity;
    this.minMarketVolume = minMarketVolume;
    // Manually add polymarket abi to the abi decoder global so aggregateTransactionsAndCall will return the correctly decoded data.
    const decoder = TransactionDataDecoder.getInstance();
    decoder.abiDecoder.addABI(binaryAdapterAbi);
    decoder.abiDecoder.addABI(ctfAdapterAbi);
  }

  // Main function to check recent proposals against Polymarket API data.
  async checkRecentProposals() {
    this.logger.debug({
      at: "PolymarketNotifier",
      message: "Checking for past proposals",
      apiEndpoint: this.apiEndpoint,
      minAcceptedPrice: this.minAcceptedPrice,
      minMarketLiquidity: this.minMarketLiquidity,
      minMarketVolume: this.minMarketVolume,
    });
    const currentTime = await this.getTime();
    const notifiedProposals = await this.getNotifiedProposals();
    const questionData = await this.getQuestionData();

    // gets the most updated OO contracts
    const optimisticOracleAddressV1 = await getAddress("OptimisticOracle", 137);
    const optimisticOracleAbiV1 = await getAbi("OptimisticOracle");
    const optimisticOracleV1 = await new this.web3.eth.Contract(optimisticOracleAbiV1, optimisticOracleAddressV1);

    const optimisticOracleAddressV2 = await getAddress("OptimisticOracleV2", 137);
    const optimisticOracleAbiV2 = await getAbi("OptimisticOracleV2");
    const optimisticOracleV2 = await new this.web3.eth.Contract(optimisticOracleAbiV2, optimisticOracleAddressV2);

    // gets all ProposePrice events using ethers query filter api. fromBlock is set to block of the latest OO deployment.
    const currentBlock = await this.web3.eth.getBlockNumber();
    const fromBlock = currentBlock - 120_000 * 10; // 120k blocks is roughly 3 days in polygon
    const ooDefaultLiveness = 7200; // polymarket uses the default
    const optimisticOracleEventsV1 = await optimisticOracleV1.getPastEvents("ProposePrice", { fromBlock: fromBlock });
    const optimisticOracleEventsV2 = await optimisticOracleV2.getPastEvents("ProposePrice", { fromBlock: fromBlock });
    const events = [...optimisticOracleEventsV1, ...optimisticOracleEventsV2];

    // creates array for each event
    const proposalEvents = events.map((request) => ({
      txHash: request.transactionHash,
      requester: request.returnValues["requester"],
      proposer: request.returnValues["proposer"],
      timestamp: Number(request.returnValues["timestamp"]),
      expirationTimestamp: Number(request.returnValues["expirationTimestamp"]),
      proposalTimestamp: Number(request.returnValues["expirationTimestamp"]) - ooDefaultLiveness,
      identifier: request.returnValues["identifier"],
      ancillaryData: request.returnValues["ancillaryData"],
      proposedPrice: this.web3.utils.fromWei(request.returnValues["proposedPrice"]).toString(),
    }));

    // combines data from the Polymarket API data to the proposal event based on ancillaryData
    const proposalData = proposalEvents
      // .filter((proposalEvent) => proposalEvent.expirationTimestamp > currentTime)
      .filter((proposalEvent) =>
        questionData.find((proposals) => proposals.ancillaryData === proposalEvent.ancillaryData)
      )
      .map((proposalEvent) => ({
        ...proposalEvent,
        ...questionData.find((proposals) => proposals.ancillaryData === proposalEvent.ancillaryData),
      }))
      .map((proposal) => {
        // get the price before the proposal timestamp
        const outcome1PriceBeforeProposal = proposal.outcome1HistoricPrices
          .reverse()
          .find((price) => price.t < proposal.proposalTimestamp);
        const outcome2PriceBeforeProposal = proposal.outcome2HistoricPrices
          .reverse()
          .find((price) => price.t < proposal.proposalTimestamp);
        return {
          ...proposal,
          outcome1PriceBeforeProposal: outcome1PriceBeforeProposal.p,
          outcome2PriceBeforeProposal: outcome2PriceBeforeProposal.p,
        };
      });

    // checks the proposed price against the Polymarket API data
    const recentProposals = proposalData
      .map((contract) => {
        // excluding proposals without a proposed price and the requester is not Polymarket
        // the threshold for accepting a proposal is valid is currently set to 0.95 but can be adjusted
        if (
          !contract.timestamp ||
          !contract.proposedPrice ||
          contract.outcome1Price === undefined ||
          contract.outcome2Price === undefined ||
          (contract.requester !== binaryAdapterAddress && contract.requester !== ctfAdapterAddress)
        ) {
          return null;
        }
        // ensures the API price is greater than 0.95 when a 1 is proposed
        if (
          contract.proposedPrice === "1" &&
          contract.outcome1PriceBeforeProposal != 0.5 &&
          contract.outcome1PriceBeforeProposal > this.minAcceptedPrice
        ) {
          return null;
        }
        // ensures the API price is greater than 0.95 when a 1 is proposed
        if (
          contract.proposedPrice === "0" &&
          contract.outcome2PriceBeforeProposal != 0.5 &&
          contract.outcome2PriceBeforeProposal > this.minAcceptedPrice
        ) {
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
    const binaryAdapterContract = await new this.web3.eth.Contract(binaryAdapterAbi, binaryAdapterAddress);
    const ctfAdapterContract = await new this.web3.eth.Contract(ctfAdapterAbi, ctfAdapterAddress);

    // Polymarket API

    const aMonthAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24;

    const whereClause =
      "active = true" +
      " AND question_ID IS NOT NULL" +
      " AND clob_Token_Ids IS NOT NULL" +
      ` AND (resolved_by = '${binaryAdapterAddress}' OR resolved_by = '${ctfAdapterAddress}')` +
      ` AND EXTRACT(EPOCH FROM TO_TIMESTAMP(end_date, 'Month DD, YYYY')) > ${aMonthAgo}` +
      " AND uma_resolution_status='resolved'";

    const query = `
    {
      markets(where: "${whereClause}", order: "created_at desc") {
        resolvedBy
        questionID
        createdAt
        question
        outcomes
        outcomePrices
        liquidityNum
        volumeNum
        clobTokenIds
      }
    }
    `;

    const { markets: polymarketContracts } = await request(this.graphqlEndpoint, query);
    assert(polymarketContracts && polymarketContracts.length, "Requires polymarket api data");

    // Get the price history for each market
    let marketsWithPriceHistory = await Promise.all(
      polymarketContracts.map(async (polymarketContract) => {
        // startTs 24 hours ago
        const startTs = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
        const endTs = Math.floor(Date.now() / 1000);
        const marketOne = JSON.parse(polymarketContract.clobTokenIds)[0];
        const marketTwo = JSON.parse(polymarketContract.clobTokenIds)[1];
        const apiUrlOne = this.apiEndpoint + `/prices-history?startTs=${startTs}&endTs=${endTs}&market=${marketOne}`;
        const apiUrlTwo = this.apiEndpoint + `/prices-history?startTs=${startTs}&endTs=${endTs}&market=${marketTwo}`;
        const { history: outcome1HistoricPrices } = await this.networker.getJson(apiUrlOne, { method: "get" });
        const { history: outcome2HistoricPrices } = await this.networker.getJson(apiUrlTwo, { method: "get" });
        return {
          ...polymarketContract,
          outcome1HistoricPrices,
          outcome2HistoricPrices,
        };
      })
    );

    marketsWithPriceHistory = marketsWithPriceHistory.filter(
      (polymarketContract) =>
        // If the dont have price history then they are old markets that we dont want to check.
        polymarketContract.outcome1HistoricPrices.length || polymarketContract.outcome2HistoricPrices.length
    );

    const transactions = marketsWithPriceHistory.map((polymarketContract) => {
      const resolutionContract =
        polymarketContract.resolveBy === binaryAdapterAddress ? binaryAdapterContract : ctfAdapterContract;

      return {
        target: resolutionContract.options.address,
        callData: resolutionContract.methods.questions(polymarketContract.questionID).encodeABI(),
      };
    });

    const chunks = [];
    const chunkSize = 250;
    for (let i = 0; i < transactions.length; i += chunkSize) {
      chunks.push(transactions.slice(i, i + chunkSize));
    }

    // Since the Polymarket API doesn't have ancillaryData included, calls questions method using questionId as argument to link PM and event data
    const ancillaryData = [];
    for (let j = 0; j < chunks.length; j++) {
      const chunk = chunks[j];
      const chunkAncillaryData = (await aggregateTransactionsAndCall(multicallAddress, this.web3, chunk)).map(
        ({ ancillaryData }, i) => {
          const {
            questionID,
            question,
            outcomes: outcomesString,
            outcomePrices: outcomePricesString,
            outcome1HistoricPrices,
            outcome2HistoricPrices,
          } = marketsWithPriceHistory[j * chunkSize + i];
          const outcomes = JSON.parse(outcomesString);
          const outcomePrices = JSON.parse(outcomePricesString);

          return {
            questionID,
            question,
            ancillaryData,
            outcome1: outcomes[0],
            outcome1Price: Number(outcomePrices[0]).toFixed(4),
            outcome2: outcomes[1],
            outcome2Price: Number(outcomePrices[1]).toFixed(4),
            clobTokenIds: JSON.parse(polymarketContracts[i].clobTokenIds),
            outcome1HistoricPrices,
            outcome2HistoricPrices,
          };
        }
      );
      ancillaryData.push(...chunkAncillaryData);
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

  _generateUILink(transactionHash, chainId) {
    return `<https://oracle.umaproject.org/request?transactionHash=${transactionHash}&chainId=${chainId} | View in the Oracle UI.>`;
  }
}

module.exports = { PolymarketNotifier };
