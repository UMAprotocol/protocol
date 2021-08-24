import { PriceFeedInterface } from "./PriceFeedInterface";
import { parseFixed } from "@uma/common";
import type { Logger } from "winston";
import type Web3 from "web3";
import type { NetworkerInterface } from "./Networker";
import type { BN } from "../types";

export class CoinGeckoPriceFeed extends PriceFeedInterface {
  private priceHistory: { time: number; price: BN }[];
  private readonly uuid: string;
  private readonly convertPriceFeedDecimals: (number: number | string | BN) => BN;
  private lastUpdateTime: null | number = null;
  private currentPrice: null | BN = null;

  /**
   * @notice Constructs the CoinGeckoPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} contractAddress Cryptocurrency contract address in mainnet.
   * @param {String} quoteCurrency Currency to use for displaying the price (currency list: https://api.coingecko.com/api/v3/simple/supported_vs_currencies).
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Bool} invertPrice Indicates if prices should be inverted before returned.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   */
  constructor(
    private readonly logger: Logger,
    public readonly web3: Web3,
    private readonly contractAddress: string,
    private readonly quoteCurrency: string,
    private readonly lookback: number,
    private readonly networker: NetworkerInterface,
    private readonly getTime: () => Promise<number>,
    private readonly minTimeBetweenUpdates: number,
    private readonly invertPrice?: boolean,
    private readonly priceFeedDecimals = 18
  ) {
    super();
    this.uuid = `CoinGecko-${contractAddress}-${quoteCurrency}`;

    this.priceHistory = []; // array of { time: number, price: BN }

    this.convertPriceFeedDecimals = (number) => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number.
      // Note: Must ensure that `number` has no more decimal places than `priceFeedDecimals`.
      return this.web3.utils.toBN(
        parseFixed(number.toString().substring(0, priceFeedDecimals), priceFeedDecimals).toString()
      );
    };
  }

  public async update(): Promise<void> {
    const currentTime = await this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== null && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "CoinGeckoPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTime + this.minTimeBetweenUpdates - currentTime,
      });
      return;
    }

    this.logger.debug({
      at: "CoinGeckoPriceFeed",
      message: "Updating CoinGeckoPriceFeed",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime,
    });

    // 1. Construct URL.
    // See https://www.coingecko.com/api/documentations/v3#/operations/simple/get_simple_token_price__id_ for how this url is constructed.
    const url =
      "https://api.coingecko.com/api/v3/simple/token_price/ethereum" +
      `?contract_addresses=${this.contractAddress}&vs_currencies=${this.quoteCurrency}`;

    // 2. Send request.
    const response = await this.networker.getJson(url);

    // 3. Check response.
    if (!response || !response[this.contractAddress] || !response[this.contractAddress][this.quoteCurrency]) {
      throw new Error(`🚨Could not parse result from url ${url}: ${JSON.stringify(response)}`);
    }

    // 4. Parse result.
    // Return data structure:
    // {
    //   "<contractAddress>": {
    //     "<currency>": <price>
    //   }
    // }
    const newPrice = this.convertPriceFeedDecimals(response[this.contractAddress][this.quoteCurrency]);

    // 5. Store results.
    this.currentPrice = newPrice;
    this.lastUpdateTime = currentTime;
    this.priceHistory.push({ time: currentTime, price: newPrice });
  }

  public getCurrentPrice(): BN | null {
    return this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
  }

  public async getHistoricalPrice(time: number): Promise<BN | null> {
    if (this.lastUpdateTime === undefined) {
      throw new Error(`${this.uuid}: undefined lastUpdateTime`);
    }

    let matchingPrice;
    for (const history of this.priceHistory) {
      const minTime = history.time - this.lookback;
      const maxTime = history.time;

      if (time >= minTime && time <= maxTime) {
        matchingPrice = history.price;
        break;
      }
    }

    if (!matchingPrice) {
      throw new Error(`${this.uuid}: no matching price`);
    }

    return (this.invertPrice ? this._invertPriceSafely(matchingPrice) : matchingPrice) || null;
  }

  public getLastUpdateTime(): null | number {
    return this.lastUpdateTime;
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }

  public getLookback(): number {
    return this.lookback;
  }

  private _invertPriceSafely(priceBN: BN | null): BN | null {
    if (priceBN && !priceBN.isZero()) {
      return this.convertPriceFeedDecimals("1").mul(this.convertPriceFeedDecimals("1")).div(priceBN);
    } else {
      return null;
    }
  }
}
