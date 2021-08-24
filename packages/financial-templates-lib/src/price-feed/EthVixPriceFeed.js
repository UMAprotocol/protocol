const assert = require("assert");
const moment = require("moment");
const { parseFixed } = require("@uma/common");
const { PriceFeedInterface } = require("./PriceFeedInterface");

// An implementation of PriceFeedInterface that uses the dVIX API to retrieve ethVIX prices.
class ETHVIXPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs price feeds for indexes listed on dVIX.io.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {Boolean} inverse Whether to return the short/inverse result.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   */
  constructor(logger, web3, inverse, networker, getTime, minTimeBetweenUpdates = 60, priceFeedDecimals = 18) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.inverse = inverse;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.priceFeedDecimals = priceFeedDecimals;

    this.uuid = `dVIX.${inverse ? "iethVIX" : "ethVIX"}`;
    this.historicalPrices = [];

    this.toBN = this.web3.utils.toBN;

    this.convertPriceFeedDecimals = (number) => {
      // Converts the decimal price result to a BigNumber integer scaled to wei units.
      // Note: Must ensure that `number` has no more decimal places than `priceFeedDecimals`.
      return this.toBN(parseFixed(number.toString().substring(0, priceFeedDecimals), priceFeedDecimals).toString());
    };
  }

  getCurrentPrice() {
    assert(this.lastUpdateTime, `${this.uuid}: undefined lastUpdateTime. Update required.`);
    return this.convertPriceFeedDecimals(this.currentPrice);
  }

  async getHistoricalPrice(time) {
    assert(this.lastUpdateTime, `${this.uuid}: undefined lastUpdateTime. Update required.`);

    assert(
      moment.utc(time).isAfter(this.historicalPrices[0].timestamp),
      `${this.uuid}: The requested time precedes available data.`
    );

    // Rounds timestamp down to the nearest 15m, the minimum index update frequency
    let roundedTime = moment.utc(time).startOf("minute");
    if (roundedTime.minutes() % 15) {
      roundedTime = roundedTime.subtract(roundedTime.minutes() % 15, "minutes");
    }

    const result = this.historicalPrices.find((price) => roundedTime.isSame(price.timestamp));
    assert(result, `${this.uuid}: No cached result found for timestamp: ${roundedTime.toISOString()}`);

    return this.convertPriceFeedDecimals(result.vix);
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  async update() {
    const currentTime = this.getTime();
    const earliestAllowableUpdateTime = currentTime + moment.duration(this.minTimeBetweenUpdates, "seconds");

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && moment(currentTime).isSameOrAfter(earliestAllowableUpdateTime)) {
      console.log({
        at: "ETHVIXPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: earliestAllowableUpdateTime - currentTime,
      });
      return;
    }

    this.logger.debug({
      at: "ETHVIXPriceFeed",
      message: "Updating",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime,
    });

    // 1. Request the data.
    const priceUrl = "https://dvix.io/api/historicalData?currency=ETH";
    const response = await this.networker.getJson(priceUrl);

    // 2. Check the response.
    assert(
      Array.isArray(response) && response.length,
      `🚨 Could not fetch historical prices from url ${priceUrl}: ${JSON.stringify(response)}`
    );

    // Expected response data structure:
    // [
    //   {
    //     "timestamp": "2021-03-24T15:00:00.000Z",
    //     "iVix": "142.44",
    //     "vix": "70.20",
    //     ...
    //   },
    //   ...
    // ]

    // 3. Sort the results in case the data source didn't already.
    response.sort((a, b) => moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf());

    // 4. Get last result in the stack.
    const mostRecent = response[response.length - 1];

    // 5. Store results.
    this.lastUpdateTime = currentTime;
    this.historicalPrices = [...this.historicalPrices, ...response];
    this.currentPrice = this.inverse ? mostRecent.iVix : mostRecent.vix;
  }
}

module.exports = { ETHVIXPriceFeed };
