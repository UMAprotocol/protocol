const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@uma/common");
const { computeTWAP } = require("./utils");

// An implementation of PriceFeedInterface retrieves RAI RedemptionRate from subgraphs.

class RAIRedemptionRatePriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the RAIRedemptionRatePriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {String} rateType Name of price field to retrieve from subgraph, like "annualizedRate"
   * @param {String} medianType Type of processing on prices, valid values are "TWAP" and "GM".
   *      where, TWAP stands for Time-Weighted Average Price and GM, Geometric Mean
   * @param {Number} medianWindow Time frame to perform median operation
   *      if set to 0, then price is returned as it is without 'medianType' op
   * @param {String} subgraph_endpoint RAI subgraph endpoint that accepts GraphQL queries
   * @param {Number} subgraphPrecision Precision of prices from subgraph
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   */

  constructor(
    logger,
    web3,
    lookback,
    networker,
    getTime,
    minTimeBetweenUpdates,
    rateType = "annualizedRate",
    medianType = "TWAP",
    medianWindow = 0,
    subgraph_endpoint = "https://subgraph.reflexer.finance/subgraphs/name/reflexer-labs/rai",
    subgraphPrecision = 27, // subgraph return values in RAY decimals
    priceFeedDecimals = 18
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    this.supportedRateTypes = ["annualizedRate", "perSecondRate", "twentyFourHourlyRate"];
    if (!this.supportedRateTypes.includes(rateType)) {
      throw new Error(
        `${rateType} is not a supported by this price feed. Supported types are - ${this.supportedRateTypes}`
      );
    }

    this.supportedMedianTypes = ["TWAP", "GM"];
    if (!this.supportedMedianTypes.includes(medianType)) {
      throw new Error(
        [
          `${rateType} median type is not a supported by this price feed.`,
          `Supported median types are - ${this.supportedMedianTypes}`
        ].join(" ")
      );
    }

    this.uuid = `RAIRedemption-${rateType}-${medianType}`;
    this.lookback = lookback;
    this.rateType = rateType;
    this.subgraph_endpoint = subgraph_endpoint;
    this.subgraphPrecision = subgraphPrecision;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.priceFeedDecimals = priceFeedDecimals;
    this.medianType = medianType;
    this.medianWindow = medianWindow;

    this.toBN = this.web3.utils.toBN;

    this.toBN = this.web3.utils.toBN;

    this.convertPriceFeedDecimals = number => {
      return this.toBN(
        parseFixed(
          // we can safely use number.indexOf() as number will always be a float string
          number.toString().substring(0, priceFeedDecimals + number.toString().indexOf(".") + 1),
          priceFeedDecimals
        ).toString()
      );
    };
  }

  getType() {
    return this.medianType;
  }

  isTypeTWAP() {
    return this.medianType.toUpperCase() === "TWAP";
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  getHistoricalRawPrice(time) {
    let rawPrice = null;
    for (var i = 0; i < this.historicalPrices.length - 1; i++) {
      if (this.historicalPrices[i].timestamp <= time && this.historicalPrices[i + 1].timestamp >= time) {
        rawPrice = this.historicalPrices[i].price;
      }
    }
    return rawPrice;
  }

  async getHistoricalPrice(time) {
    if (time < this.lastUpdateTime - this.lookback) {
      // Requesting an historical TWAP earlier than the lookback.
      throw new Error(`${this.uuid} time ${time} is earlier than TWAP window`);
    }

    const historicalPrice = this.medianWindow
      ? this.isTypeTWAP()
        ? this._computeTWAP(this.historicalPrices, time - this.medianWindow, time)
        : this._computeGM(this.historicalPrices, time - this.medianWindow, time)
      : this.getHistoricalRawPrice(time);

    if (historicalPrice) {
      return historicalPrice;
    } else {
      throw new Error(`${this.uuid} missing historical price @ time ${time}`);
    }
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getLookback() {
    return this.lookback;
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }

  async update() {
    const currentTime = this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "RAIRedemptionRatePriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime
      });
      return;
    }

    this.logger.debug({
      at: "RAIRedemptionRatePriceFeed",
      message: "Updating RAIRedemptionRatePriceFeed",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    const earliestHistoricalTimestamp = currentTime - (this.lookback + this.medianWindow);

    const newHistoricalPrices = await this._getPricesFromSubgraph(
      earliestHistoricalTimestamp,
      currentTime,
      this.rateType
    );

    if (!newHistoricalPrices[0].timestamp >= earliestHistoricalTimestamp) {
      this.logger.debug({
        at: "RAIRedemptionRatePriceFeed",
        message: "Failed to retrieve all the prices for lookback window. Try reducing lookback or medianWindow",
        requestedFromTimestamp: earliestHistoricalTimestamp,
        lastPriceTimestampFromSubgraph: newHistoricalPrices[0].timestamp
      });
      return;
    }

    const newPrice = this.medianWindow
      ? this.isTypeTWAP()
        ? this._computeTWAP(newHistoricalPrices, currentTime - this.medianWindow, currentTime)
        : this._computeGM(newHistoricalPrices, currentTime - this.medianWindow, currentTime)
      : newHistoricalPrices[newHistoricalPrices.length - 1].price;

    // 5. Store results.
    this.currentPrice = newPrice;
    this.historicalPrices = newHistoricalPrices;
    this.lastUpdateTime = currentTime;
  }

  async _getPricesFromSubgraph(fromTimestamp, toTimestamp, rateType) {
    const data = {
      query: `
      {
        redemptionRates(
          first: 1000,
          orderBy: createdAt,
          orderDirection: desc,
          where: {
            createdAt_gte: ${fromTimestamp},
            createdAt_lte: ${toTimestamp}
          }) {
            ${rateType}
            createdAt
            createdAtBlock
        }
      }
      `
    };

    const options = {
      method: "POST",
      body: JSON.stringify(data)
    };

    const response = await this.networker.getJson(this.subgraph_endpoint, options);
    // Return data structure:
    // {
    //     "data": {
    //       "redemptionRates": [
    //         {
    //           "createdAt": "1617357274",
    //           "createdAtBlock": "12159386",
    //           "twentyFourHourlyRate": "0.999613665386634504687653838"
    //         },
    //         ...
    //        ]
    //     }
    // }
    return response.data.redemptionRates
      .map(rate => ({
        price: this.convertPriceFeedDecimals(rate[rateType]),
        rawPrice: rate[rateType],
        block: rate["createdAtBlock"],
        timestamp: Number(rate["createdAt"])
      }))
      .reverse();
  }

  _computeTWAP(historicalPrices, startTime, endTime) {
    const events = historicalPrices.map(e => {
      return [e.timestamp, e.price];
    });
    return computeTWAP(events, startTime, endTime, this.toBN("0"));
  }
  _computeGM(historicalPrices, startTime, endTime) {
    const prices = historicalPrices
      .filter(e => e.timestamp >= startTime || e.timestamp <= endTime)
      // This will convert BN to js float, and so some precision is lost
      .map(e => parseFloat(e.rawPrice));
    if (prices.length != 0) {
      return this.convertPriceFeedDecimals(
        Math.pow(
          prices.reduce((a, b) => a * b),
          1 / prices.length
        )
      );
    }
  }
}
module.exports = {
  RAIRedemptionRatePriceFeed
};
