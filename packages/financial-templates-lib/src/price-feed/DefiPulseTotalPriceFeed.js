const { parseFixed } = require("@uma/common");
const { PriceFeedInterface } = require("./PriceFeedInterface");
const assert = require("assert");

// An implementation of PriceFeedInterface that uses DefiPulse Data api to retrieve prices.
class DefiPulseTotalPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the DefiPulseTVL_ALLPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} apiKey DeFiPulse Data API key. Note: these API keys are rate-limited.
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   */
  constructor(logger, web3, apiKey, lookback, networker, getTime, minTimeBetweenUpdates, priceFeedDecimals = 18) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.apiKey = apiKey;
    this.lookback = lookback;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.priceFeedDecimals = priceFeedDecimals;
    this.uuid = "DefiPulseTVL";

    this.toWei = this.web3.utils.toWei;

    this.historicalPrices = [];
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  async getHistoricalPrice(time) {
    if (this.lastUpdateTime === undefined) {
      throw new Error(`${this.uuid}: undefined lastUpdateTime`);
    }

    let closestTime = { timestamp: 0, tvlUSD: 0 };

    // Go through all values and find time that that is the largest and still less than 'time'
    for (let i = 0; i < this.historicalPrices.length; i++) {
      let past = this.historicalPrices[i].timestamp;
      let val = this.historicalPrices[i].tvlUSD;

      if (past > closestTime.timestamp && past < time) {
        closestTime.timestamp = past;
        closestTime.tvlUSD = val;
      }
    }

    const historicalPrice = this.scaleResult(closestTime.tvlUSD);

    if (closestTime.timestamp === 0) {
      throw new Error(`${this.uuid}: No cached time found for timestamp: ${time}`);
    } else {
      return historicalPrice;
    }
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  async update() {
    const currentTime = this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "DefiPulseTotalPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime
      });
      return;
    }

    this.logger.debug({
      at: "DefiPulseTotalPriceFeed",
      message: "Updating",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // 1. Construct URLs.
    const priceUrl = `https://data-api.defipulse.com/api/v1/defipulse/api/GetHistory?period=1w&api-key=${this.apiKey}`;

    // 2. Send requests.
    const response = await this.networker.getJson(priceUrl);

    // 3. Check responses.
    if (!response) {
      throw new Error(`🚨Could not parse price result from url ${priceUrl}: ${JSON.stringify(response)}`);
    }

    // 4. Parse results.
    // Return data structure:
    //        [{
    //            "timestamp":"1611511200"
    //            "tvlUSD":25583565042,
    //             ...
    //          },
    //           {
    //            "timestamp":"1611507600",
    //            "tvlUSD":25177860561
    //             ...
    //          },
    //        ]

    // Get tvlUSD for most most recent timestamp
    let mostRecent = { timestamp: 0, tvlUSD: 0 };
    for (let i = 0; i < response.length; i++) {
      if (Number(response[i].timestamp) > mostRecent.timestamp) {
        mostRecent.timestamp = Number(response[i].timestamp);
        mostRecent.tvlUSD = Number(response[i].tvlUSD);
      }
    }

    const newPrice = this.scaleResult(mostRecent.tvlUSD);

    // 5. Store results.
    this.lastUpdateTime = currentTime;
    this.currentPrice = newPrice;
    this.historicalPrices = response;
  }

  scaleResult(_tvlUSD) {
    // As described in UMIP 24
    // In an effort to make the token price affordable, the value of the token is the tvlUSD divided by 1 billion.
    // We also cut off precision after 3 decimals to match the specified price step of .001

    const billion = 1000000000;

    const precision = 3;
    assert(
      precision <= this.priceFeedDecimals,
      `Precision of ${precision} is > priceFeedDecimals of ${this.priceFeedDecimals}. Cannot have more precision than decimals`
    );
    const decimalValue = (_tvlUSD / billion).toFixed(precision);
    const fixedPointValue = parseFixed(decimalValue.toString(), this.priceFeedDecimals);
    return this.web3.utils.toBN(fixedPointValue.toString());
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }
}

module.exports = {
  DefiPulseTotalPriceFeed
};
