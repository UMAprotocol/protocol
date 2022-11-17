import assert = require("assert");
import { FixedNumber } from "@ethersproject/bignumber";
import { PriceFeedInterface } from "./PriceFeedInterface";
import type { Logger } from "winston";
import Web3 from "web3";
import { BN } from "../types";
import { NetworkerInterface } from "./Networker";

interface RapidAPITopResponse {
  Gainers: {
    Commons_Symbol: string;
    Commons_Daily_Change_Percent: string;
    Commons_Price: string;
    Commons_Volume: string;
  }[];
}

interface RapidAPIHistoricalResponse {
  meta: {
    currency: string;
    symbol: string;
    exchangeName: string;
    instrumentType: string;
    firstTradeDate: number;
    regularMarketTime: number;
    gmtoffset: number;
    timezone: string;
    exchangeTimezoneName: string;
    regularMarketPrice: number;
    chartPreviousClose: number;
    priceHint: number;
    dataGranularity: string;
    range: string;
  };
  items: {
    [key: string]: {
      date: string;
      date_utc: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      adjclose: number;
    };
  };
  error: null;
}

interface RapidAPIResponse {
  ask: number;
  askSize: number;
  averageDailyVolume10Day: number;
  averageDailyVolume3Month: number;
  bid: number;
  bidSize: number;
  bookValue: number;
  currency: string;
  dividendDate: null;
  earningsTimestamp: null;
  earningsTimestampStart: null;
  earningsTimestampEnd: null;
  epsForward: null;
  epsTrailingTwelveMonths: number;
  exchange: string;
  exchangeDataDelayedBy: number;
  exchangeTimezoneName: string;
  exchangeTimezoneShortName: string;
  fiftyDayAverage: number;
  fiftyDayAverageChange: number;
  fiftyDayAverageChangePercent: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekHighChange: number;
  fiftyTwoWeekHighChangePercent: number;
  fiftyTwoWeekLow: number;
  fiftyTwoWeekLowChange: number;
  fiftyTwoWeekLowChangePercent: number;
  financialCurrency: string;
  forwardPE: null;
  fullExchangeName: string;
  gmtOffSetMilliseconds: number;
  language: string;
  longName: string;
  market: string;
  marketCap: number;
  marketState: string;
  messageBoardId: string;
  postMarketChange: null;
  postMarketChangePercent: null;
  postMarketPrice: null;
  postMarketTime: null;
  priceHint: number;
  priceToBook: number;
  quoteSourceName: string;
  quoteType: string;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketOpen: number;
  regularMarketPreviousClose: number;
  regularMarketPrice: number;
  regularMarketTime: {
    date: string;
    timezone_type: 1;
    timezone: string;
  };
  regularMarketVolume: number;
  sharesOutstanding: number;
  shortName: string;
  sourceInterval: number;
  symbol: string;
  tradeable: false;
  trailingAnnualDividendRate: number;
  trailingAnnualDividendYield: number;
  trailingPE: null;
  twoHundredDayAverage: number;
  twoHundredDayAverageChange: number;
  twoHundredDayAverageChangePercent: number;
}

export class USPAC10GPriceFeed extends PriceFeedInterface {
  private readonly uuid: string;
  private readonly toBN = Web3.utils.toBN;
  private currentPrice: BN | null = null;
  private lastUpdateTime: number | null = null;

  /**
   * @notice Constructs the USPAC10GPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
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
    // private readonly correctionFactor: string,
    private readonly rapidApiKey: string,
    private readonly interval: string = "1d",
    private readonly lookback: number,
    private readonly networker: NetworkerInterface,
    private readonly getTime: () => Promise<number>,
    private readonly priceFeedDecimals = 18,
    private readonly minTimeBetweenUpdates = 3600, // 1 hour is enough to fit in free plan (1000 requests per day)
    private readonly basketItems = 10
  ) {
    super();

    assert(rapidApiKey != null, "rapidApiKey must be provided");
    assert(basketItems <= 10, "basketItems must be less than or equal to 10");

    this.uuid = "USPAC10GPriceFeed";
  }

  public async update(): Promise<void> {
    const currentTime = await this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== null && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "USPAC10GPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTime + this.minTimeBetweenUpdates - currentTime,
      });
      return;
    }

    this.logger.debug({
      at: "USPAC10GPriceFeed",
      message: "Updating USPAC10GPriceFeed",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime,
    });

    this.currentPrice = await this.fetchCurrentPrice(currentTime, false);
    this.lastUpdateTime = currentTime;
  }

  private async fetchCurrentPrice(time: number, verbose: boolean): Promise<BN> {
    const symbolsArray = await this.fetchSymbolArray(verbose);
    const symbols = symbolsArray.join();
    const url = `https://mboum-finance.p.rapidapi.com/qu/quote?symbol=${symbols}`;
    const options = {
      method: "GET",
      headers: {
        "x-rapidapi-host": "mboum-finance.p.rapidapi.com",
        "x-rapidapi-key": this.rapidApiKey,
      },
    };
    const response = (await this.networker.getJson(url, options)) as RapidAPIResponse[] | null | undefined;

    if (response == undefined) {
      throw new Error(`🚨Could not parse price result from url ${url}: ${JSON.stringify(response)}`);
    }

    let price = FixedNumber.from(0);

    if (response.length < this.basketItems) {
      const caughtSymbols = response.map((entry) => entry.symbol);
      const missedSymbols = [];

      for (let i = 0; i < symbolsArray.length; i++) {
        if (caughtSymbols.includes(symbolsArray[i]) === false) {
          missedSymbols.push(symbolsArray[i]);
        }
      }

      if (caughtSymbols.length + missedSymbols.length !== this.basketItems)
        throw new Error(
          `🚨Could not get ${this.basketItems} quotes results from url ${url}: ${JSON.stringify(response)}`
        );

      for (let i = 0; i < missedSymbols.length; i++) {
        const symbol = missedSymbols[i];
        const url = `https://mboum-finance.p.rapidapi.com/hi/history?symbol=${symbol}&interval=${this.interval}&diffandsplits=false`;
        const options = {
          method: "GET",
          headers: {
            "x-rapidapi-host": "mboum-finance.p.rapidapi.com",
            "x-rapidapi-key": this.rapidApiKey,
          },
        };
        const response = (await this.networker.getJson(url, options)) as RapidAPIHistoricalResponse | null | undefined;

        if (response == undefined || response.items == undefined)
          throw new Error(`🚨Could not get quote results from url ${url}: ${JSON.stringify(response)}`);

        const lastValPrice = Object.values(response.items)[Object.values(response.items).length - 1].close.toString();

        price = price.addUnsafe(FixedNumber.from(lastValPrice));
      }
    }

    if (response.find((quote) => quote.regularMarketPrice === undefined)) {
      const quotes = response.map((q) => FixedNumber.from(q.regularMarketPreviousClose.toString()));
      for (const q of quotes) {
        price = price.addUnsafe(q);
      }
    } else {
      const quotes = response.map((q) => FixedNumber.from(q.regularMarketPrice.toString()));
      for (const q of quotes) {
        price = price.addUnsafe(q);
      }
    }
    price = price.divUnsafe(FixedNumber.from(this.basketItems));

    return this.toBN(
      price
        .mulUnsafe(FixedNumber.from(this.toBN("10").pow(this.toBN(this.priceFeedDecimals)).toString()))
        .round()
        .toString()
        .split(".")[0]
    );
  }

  public getCurrentPrice(): BN | null {
    return this.currentPrice;
  }

  public async getHistoricalPrice(time: number, ancillaryData: string, verbose = false): Promise<BN> {
    const symbols = await this.fetchSymbolArray(verbose);

    const symbolsHistories: RapidAPIHistoricalResponse[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const url = `https://mboum-finance.p.rapidapi.com/hi/history?symbol=${symbol}&interval=${this.interval}&diffandsplits=false`;
      const options = {
        method: "GET",
        headers: {
          "x-rapidapi-host": "mboum-finance.p.rapidapi.com",
          "x-rapidapi-key": this.rapidApiKey,
        },
      };
      const response = (await this.networker.getJson(url, options)) as RapidAPIHistoricalResponse | null | undefined;

      if (response == undefined || response.items == undefined)
        throw new Error(`🚨Could not get quote results from url ${url}: ${JSON.stringify(response)}`);

      symbolsHistories.push(response);
    }

    if (symbolsHistories.length !== this.basketItems) throw new Error(`🚨Could not get ${this.basketItems} quotes`);

    const prices = [];
    for (let i = 0; i < symbolsHistories.length; i++) {
      const items = symbolsHistories[i].items;
      const availableTimestamp = Object.keys(items).reverse();
      for (let j = 0; j < availableTimestamp.length; j++) {
        const ts = availableTimestamp[j];
        if (Number(ts) <= time) {
          prices.push(items[ts].close);
          break;
        }
      }
    }

    if (prices.length !== this.basketItems) throw new Error(`🚨Could not get and format ${this.basketItems} prices`);

    let price = FixedNumber.from(0);
    for (let i = 0; i < prices.length; i++) {
      price = price.addUnsafe(FixedNumber.from(prices[i].toString()));
    }
    price = price.divUnsafe(FixedNumber.from(this.basketItems.toString()));

    return this.toBN(
      price
        .mulUnsafe(FixedNumber.from(this.toBN("10").pow(this.toBN(this.priceFeedDecimals)).toString()))
        .round()
        .toString()
        .split(".")[0]
    );
  }

  private async fetchSymbolArray(verbose = false): Promise<string[]> {
    const url = "https://spachero-spac-database.p.rapidapi.com/top10/";
    const options = {
      method: "GET",
      headers: {
        "x-rapidapi-host": "spachero-spac-database.p.rapidapi.com",
        "x-rapidapi-key": this.rapidApiKey,
      },
      body: '{ period: "weekly", type: "common", sortby: "gainers" }',
    };
    const response = (await this.networker.getJson(url, options)) as RapidAPITopResponse | null | undefined;

    if (response == undefined || response.Gainers == undefined) {
      throw new Error(`🚨Could not parse price result from url ${url}: ${JSON.stringify(response)}`);
    }

    if (response.Gainers.length < this.basketItems) {
      throw new Error(
        `🚨Could not get at least ${this.basketItems} Gainers results from url ${url}: ${JSON.stringify(response)}`
      );
    }

    if (verbose) {
      console.log(`Rapid API response for url ${url} is ${JSON.stringify(response, null, 2)}`);
    }

    return response.Gainers.map((gainer) => gainer.Commons_Symbol).slice(0, this.basketItems);
  }

  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }

  public getLookback(): number {
    return this.lookback;
  }
}
