import assert = require("assert");
import lodash from "lodash";
import { FixedNumber } from "@ethersproject/bignumber";
import { PriceFeedInterface } from "./PriceFeedInterface";
import type { Logger } from "winston";
import Web3 from "web3";
import { BN } from "../types";
import { NetworkerInterface } from "./Networker";

interface RapidAPIQuoteReponse {
  quoteResponse?: {
    result?: { regularMarketPrice: number; symbol: string }[];
  };
}

type RapidAPIHistoryReponse = Record<
  string,
  {
    timestamp: number[];
    close: number[];
  }
>;

export class USPACPriceFeed extends PriceFeedInterface {
  private readonly uuid: string;
  private readonly toBN = Web3.utils.toBN;
  private currentPrice: BN | null = null;
  private lastUpdateTime: number | null = null;

  /**
   * @notice Constructs the USPACPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String[]} symbols Array of symbols that constitute basket
   * @param {String} correctionFactor factor to multiply basket price
   * @param {String} rapidApiKey Rapid API access key.
   * @param {String} interval granularity for price data. Example: "1m 5m 15m 1d 1wk 1mo"
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   */
  constructor(
    private readonly logger: Logger,
    private readonly web3: Web3,
    private readonly symbols: string[],
    private readonly correctionFactor: string,
    private readonly rapidApiKey: string,
    private readonly interval: string = "1m",
    private readonly lookback: number,
    private readonly networker: NetworkerInterface,
    private readonly getTime: () => Promise<number>,
    private readonly priceFeedDecimals = 18,
    private readonly minTimeBetweenUpdates = 3600 // 1 hour is enough to fit in free plan (1000 requests per day)
  ) {
    super();

    assert(symbols != null, "symbols must be provided");
    assert(rapidApiKey != null, "rapidApiKey must be provided");
    assert(correctionFactor != null, "correctionFactor must be provided");

    this.uuid = `USPACPriceFeed-${symbols.join(",")}`;
  }

  public getCurrentPrice(): BN | null {
    return this.currentPrice;
  }

  public async getHistoricalPrice(time: number, ancillaryData: string, verbose = false): Promise<BN> {
    // Construct URL.
    // https://rapidapi.com/principalapis/api/stock-data-yahoo-finance-alternative/
    const symbolsStr = this.symbols.join("%2C");
    /* range is a string with format `{number_of_days}d` */
    const range = Math.ceil(this.lookback / 3600 / 24) + "d";
    const url = `https://stock-data-yahoo-finance-alternative.p.rapidapi.com/v8/finance/spark?symbols=${symbolsStr}&range=${range}&interval=${this.interval}`;
    const options = {
      method: "GET",
      headers: {
        "x-rapidapi-host": "stock-data-yahoo-finance-alternative.p.rapidapi.com",
        "x-rapidapi-key": this.rapidApiKey,
      },
    };
    const response = (await this.networker.getJson(url, options)) as RapidAPIHistoryReponse | null | undefined;

    if (response == null) {
      throw new Error(`🚨Invalid response from url ${url}`);
    }

    if (verbose) {
      console.log(`Rapid API response for url ${url} is ${JSON.stringify(response, null, 2)}`);
    }

    // Validate response
    for (const symbol of this.symbols) {
      const stockData = response[symbol];
      if (stockData == null) {
        throw new Error(`🚨Could not parse price result from url ${url}: missing data for symbol ${symbol}`);
      }
      if (stockData.timestamp.length == 0 || stockData.timestamp.length != stockData.close.length) {
        throw new Error(`🚨Could not parse price result from url ${url}: invalid data for symbol ${symbol}`);
      }
      for (const ts of stockData.timestamp) {
        if (typeof ts != "number") {
          throw new Error("Could not parse data: invalid timestamp type");
        }
      }
      for (const p of stockData.close) {
        if (typeof p != "number") {
          throw new Error("Could not parse data: invalid price type");
        }
      }
      for (let i = 1; i < stockData.timestamp.length; i++) {
        if (stockData.timestamp[i] <= stockData.timestamp[i - 1]) {
          throw new Error(`Could not parse data: timestamps for ${symbol} are not increasing monotonously`);
        }
      }
    }

    // Get prices
    const prices = this.symbols.map((symbol) => {
      const stockData = response[symbol];

      // iterate over timestamps and prices backwards, until we find timestamp
      // that is earlier then given time
      const result = lodash
        .zip(stockData.timestamp, stockData.close)
        .reverse()
        .find((item) => time >= (item[0] as number));
      if (result == null) {
        throw new Error(`Could not get historical price for symbol ${symbol}: timestamp ${time} past last data point`);
      }
      const price = result[1] as number;
      return price;
    });

    return this.calculateBasketPrice(prices);
  }

  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }

  public getLookback(): number {
    return this.lookback;
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }

  public async update(): Promise<void> {
    const currentTime = await this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== null && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "USPACPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTime + this.minTimeBetweenUpdates - currentTime,
      });
      return;
    }

    this.logger.debug({
      at: "USPACPriceFeed",
      message: "Updating USPACPriceFeed",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime,
    });

    this.currentPrice = await this.fetchCurrentPrice(currentTime, false);
    this.lastUpdateTime = currentTime;
  }

  private async calculateBasketPrice(stockPrices: number[]) {
    const prices = stockPrices.map((rawPrice) => FixedNumber.from(rawPrice.toString()));

    // Calculate average price
    let price = FixedNumber.from(0);
    for (const p of prices) {
      price = price.addUnsafe(p);
    }
    price = price.divUnsafe(FixedNumber.from(this.symbols.length));

    // Apply correction factor
    price = price.mulUnsafe(FixedNumber.from(this.correctionFactor.toString()));

    // Apply priceFeedDecimals
    return this.toBN(
      price
        .mulUnsafe(FixedNumber.from(this.toBN("10").pow(this.toBN(this.priceFeedDecimals)).toString()))
        .round()
        .toString()
        .split(".")[0]
    );
  }

  private async fetchCurrentPrice(time: number, verbose: boolean): Promise<BN> {
    // Construct URL.
    // https://rapidapi.com/principalapis/api/stock-data-yahoo-finance-alternative/
    const symbolsStr = this.symbols.join("%2C");
    const url = `https://stock-data-yahoo-finance-alternative.p.rapidapi.com/v6/finance/quote?symbols=${symbolsStr}`;
    const options = {
      method: "GET",
      headers: {
        "x-rapidapi-host": "stock-data-yahoo-finance-alternative.p.rapidapi.com",
        "x-rapidapi-key": this.rapidApiKey,
      },
    };
    const response = (await this.networker.getJson(url, options)) as RapidAPIQuoteReponse | null | undefined;

    const data = response && response.quoteResponse && response.quoteResponse.result;

    // Check responses.
    if (data == null || data.length == 0) {
      throw new Error(`🚨Could not parse price result from url ${url}: ${JSON.stringify(response)}`);
    }

    if (verbose) {
      console.log(`Rapid API response for url ${url} is ${JSON.stringify(response, null, 2)}`);
    }

    // Parse results.
    // For every symbol, get last known price
    const prices = this.symbols.map((symbol) => {
      const item = data.find((item) => item.symbol == symbol);
      if (item == null) {
        throw new Error(`🚨Response from ${url} lacks data for symbol ${symbol}: ${JSON.stringify(response)}`);
      }
      const rawPrice = item.regularMarketPrice;
      if (rawPrice == null) {
        throw new Error(`🚨Response from ${url} has no price for ${symbol}: ${JSON.stringify(response)}`);
      }
      return rawPrice;
    });

    return this.calculateBasketPrice(prices);
  }
}
