import assert from "assert";
import moment from "moment";
import { parseFixed } from "@uma/common";
import { PriceFeedInterface } from "./PriceFeedInterface";
import type { Logger } from "winston";
import Web3 from "web3";
import { NetworkerInterface } from "./Networker";
import type { BN } from "../types";

// An implementation of PriceFeedInterface that uses the dVIX API to retrieve ethVIX prices.
export class ETHVIXPriceFeed extends PriceFeedInterface {
  private readonly uuid: string;
  private readonly toBN = Web3.utils.toBN;
  private readonly convertPriceFeedDecimals: (number: number | string | BN) => BN;
  private historicalPrices: { timestamp: string; vix: string; iVix: string }[] = [];
  private currentPrice: BN | null = null;
  private lastUpdateTime: number | null = null;

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
  constructor(
    private readonly logger: Logger,
    private readonly web3: Web3,
    private readonly inverse: boolean,
    private readonly networker: NetworkerInterface,
    private readonly getTime: () => Promise<number>,
    private readonly minTimeBetweenUpdates = 60,
    private readonly priceFeedDecimals = 18
  ) {
    super();
    this.uuid = `dVIX.${inverse ? "iethVIX" : "ethVIX"}`;
    this.convertPriceFeedDecimals = (number) => {
      // Converts the decimal price result to a BigNumber integer scaled to wei units.
      // Note: Must ensure that `number` has no more decimal places than `priceFeedDecimals`.
      return this.toBN(parseFixed(number.toString().substring(0, priceFeedDecimals), priceFeedDecimals).toString());
    };
  }

  public getCurrentPrice(): BN {
    assert(this.lastUpdateTime && this.currentPrice, `${this.uuid}: undefined lastUpdateTime. Update required.`);
    return this.convertPriceFeedDecimals(this.currentPrice);
  }

  public async getHistoricalPrice(time: number): Promise<BN> {
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

  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }

  async update(): Promise<void> {
    const currentTime = await this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== null && this.lastUpdateTime + this.minTimeBetweenUpdates >= currentTime) {
      console.log({
        at: "ETHVIXPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTime + this.minTimeBetweenUpdates - currentTime,
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

  public getLookback(): number {
    return this.lastUpdateTime === null || this.historicalPrices.length === 0
      ? 0
      : this.lastUpdateTime - moment(this.historicalPrices[this.historicalPrices.length - 1].timestamp).unix();
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }
}
