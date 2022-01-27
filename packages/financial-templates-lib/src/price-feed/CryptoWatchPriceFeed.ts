import { PriceFeedInterface } from "./PriceFeedInterface";
import { parseFixed, formatFixed, parseAncillaryData } from "@uma/common";
import { computeTWAP } from "./utils";
import type { Logger } from "winston";
import Web3 from "web3";
import { NetworkerInterface } from "./Networker";
import { BN } from "../types";

interface PricePeriod {
  openTime: number;
  closeTime: number;
  openPrice: BN;
  closePrice: BN;
}

// Options for retrieving most prices such as TWAP length
export interface SimplePriceAncillaryData {
  twapLength: string;
}
// An implementation of PriceFeedInterface that uses CryptoWatch to retrieve prices.
export class CryptoWatchPriceFeed extends PriceFeedInterface {
  private readonly uuid: string;
  private readonly toBN = Web3.utils.toBN;
  private readonly convertPriceFeedDecimals: (number: number | string | BN) => BN;
  private currentPrice: null | BN = null;
  private lastUpdateTime: null | number = null;
  private lastAncillaryData: undefined | string = undefined;
  private historicalPricePeriods: PricePeriod[] = [];

  /**
   * @notice Constructs the CryptoWatchPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} apiKey optional CW API key. Note: these API keys are rate-limited.
   * @param {String} exchange Identifier for the exchange to pull prices from. This should be the identifier used by the
   *      exchange in CW's REST API.
   * @param {String} pair Representation of the pair the price feed is tracking. This pair should be available on the
   *      provided exchange. The string should be the representation used by CW to identify this pair.
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Bool} invertPrice Indicates if prices should be inverted before returned.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   * @param {Number} ohlcPeriod Number of seconds interval between ohlc prices requested from cryptowatch.
   * @param {Number} twapLength Number of seconds to use for TWAP window when computing prices.
   * @param {Number} historicalTimestampBuffer Number of seconds +/- beyond a price period's open and close window
   * that determines whether a historical timestamp falls "within" that price period.
   */
  constructor(
    private readonly logger: Logger,
    private readonly web3: Web3,
    private readonly apiKey: string,
    private readonly exchange: string,
    private readonly pair: string,
    private readonly lookback: number,
    private readonly networker: NetworkerInterface,
    private readonly getTime: () => Promise<number>,
    private readonly minTimeBetweenUpdates: number,
    private readonly invertPrice?: boolean,
    private readonly priceFeedDecimals = 18,
    private readonly ohlcPeriod = 60, // One minute is CryptoWatch's most granular option.
    private readonly twapLength = 0, // No TWAP by default.
    private readonly historicalTimestampBuffer = 0 // Buffer of 0 means that historical timestamp must fall strictly within a price // period's open and close time.
  ) {
    super();
    this.uuid = `Cryptowatch-${exchange}-${pair}`;

    this.convertPriceFeedDecimals = (number) => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number.
      // Note: Must ensure that `number` has no more decimal places than `priceFeedDecimals`.
      return this.toBN(parseFixed(number.toString().substring(0, priceFeedDecimals), priceFeedDecimals).toString());
    };
  }

  public getCurrentPrice(): null | BN {
    if (this.invertPrice) {
      return this._invertPriceSafely(this.currentPrice);
    } else {
      return this.currentPrice;
    }
  }

  public async getHistoricalPrice(time: number, ancillaryData?: string, verbose = false): Promise<BN> {
    if (this.lastUpdateTime === undefined) {
      throw new Error(`${this.uuid}: undefined lastUpdateTime`);
    }

    let twapLength = this.twapLength;
    // Ancillary data might contain parameters that affect how we compute the historical price, such as the twapLength.
    if (ancillaryData) {
      const parsedAncillaryData = (parseAncillaryData(ancillaryData) as unknown) as SimplePriceAncillaryData;
      if (parsedAncillaryData.twapLength) {
        twapLength = Number(parsedAncillaryData.twapLength);
      }
    }

    // Return early if computing a TWAP.
    if (twapLength) {
      let twapPrice = this._computeTwap(time, this.historicalPricePeriods, twapLength);
      if (this.invertPrice) twapPrice = this._invertPriceSafely(twapPrice);
      if (!twapPrice) {
        throw new Error(`${this.uuid}: historical TWAP computation failed due to no data in the TWAP range`);
      }
      return twapPrice;
    }

    // Set first price period in `historicalPricePeriods` to first non-null price.
    let firstPricePeriod;
    for (const p in this.historicalPricePeriods) {
      if (this.historicalPricePeriods[p] && this.historicalPricePeriods[p].openTime) {
        firstPricePeriod = this.historicalPricePeriods[p];
        break;
      }
    }

    // If there are no valid price periods, throw.
    if (!firstPricePeriod) {
      throw new Error(`${this.uuid}: no valid price periods`);
    }

    // If the time is before the first piece of data in the set, return null because
    // the price is before the lookback window.
    if (time < firstPricePeriod.openTime - this.historicalTimestampBuffer) {
      throw new Error(`${this.uuid}: time ${time} is before firstPricePeriod.openTime minus historicalTimestampBuffer`);
    }

    // historicalPricePeriods are ordered from oldest to newest.
    // This finds the first pricePeriod whose closeTime is after the provided time.
    const match = this.historicalPricePeriods.find((pricePeriod) => {
      return time <= pricePeriod.closeTime && time >= pricePeriod.openTime;
    });

    // If match doesn't succeed, then we can still try to find the nearest price and use it if its within the caller's
    // allowed margin of error.
    let returnPrice;
    if (match === undefined) {
      // Accounting for the buffer, find the price periods before and after the target time. These will be undefined if
      // not found. Reverse the search for the period so that we match the latest period that encompasses the target
      // time.
      const before = this.historicalPricePeriods
        .slice()
        .reverse()
        .find(
          (pricePeriod) =>
            time <= pricePeriod.closeTime + this.historicalTimestampBuffer && time >= pricePeriod.openTime
        );
      const after = this.historicalPricePeriods.find(
        (pricePeriod) => time >= pricePeriod.openTime - this.historicalTimestampBuffer && time <= pricePeriod.closeTime
      );

      this.logger.debug({
        at: "CryptoWatchPriceFeed",
        message: "Using historical timestamp buffer to match time",
        historicalTimestampBuffer: this.historicalTimestampBuffer,
        time: time,
        before: before
          ? `openTime: ${before?.openTime}, closeTime: ${
              before?.closeTime
            }, openPrice: ${before?.openPrice.toString()}, closePrice: ${before?.closePrice.toString()}`
          : before,
        after: after
          ? `openTime: ${after?.openTime}, closeTime: ${
              after?.closeTime
            }, openPrice: ${after?.openPrice.toString()}, closePrice: ${after?.closePrice.toString()}`
          : after,
      });

      // If there is a `before` period, then use its close time, otherwise use the `after` period's open time.
      // All things being equal we prefer prices from times before the target time because there are fewer manipulation
      // opportunities and we are not incorporating information that did not exist at the target time.
      if (before) {
        returnPrice = this.invertPrice ? this._invertPriceSafely(before.closePrice) : before.closePrice;
        if (!returnPrice) throw new Error(`${this.uuid} -- invalid price returned`);
        if (verbose) await this._printVerbose(before, returnPrice);
      } else if (after) {
        returnPrice = this.invertPrice ? this._invertPriceSafely(after.openPrice) : after.openPrice;
        if (!returnPrice) throw new Error(`${this.uuid} -- invalid price returned`);
        if (verbose) await this._printVerbose(after, returnPrice);
      } else {
        throw new Error(
          `${this.uuid}: could not match a price period with time ${time} after accounting for the historical timestamp buffer of ${this.historicalTimestampBuffer}`
        );
      }
    }
    // If we did find a match, then by default use the matched period's open price. See comment in the above block about
    // why we prefer `before` periods to `after` ones. Similar reasoning is why we default to a period's open price to
    // its close price. We prefer prices that occurred before the target time.
    else {
      // Use period close price when request time matches close time. In all other cases use open price instead.
      const matchedPrice = time === match.closeTime ? match.closePrice : match.openPrice;
      returnPrice = this.invertPrice ? this._invertPriceSafely(matchedPrice) : matchedPrice;
      if (!returnPrice) throw new Error(`${this.uuid} -- invalid price returned`);
      if (verbose) await this._printVerbose(match, returnPrice);
    }

    return returnPrice;
  }

  public getHistoricalPricePeriods(): [number, BN | null][] {
    if (!this.invertPrice)
      return this.historicalPricePeriods.map((historicalPrice) => {
        return [historicalPrice.closeTime, historicalPrice.closePrice];
      });
    else
      return this.historicalPricePeriods.map((historicalPrice) => {
        return [historicalPrice.closeTime, this._invertPriceSafely(historicalPrice.closePrice)];
      });
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

  public async update(ancillaryData?: string): Promise<void> {
    const currentTime = await this.getTime();

    // Return early if the last call for this ancillary data was too recent.
    if (
      this.lastUpdateTime !== null &&
      this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime &&
      ancillaryData === this.lastAncillaryData
    ) {
      this.logger.debug({
        at: "CryptoWatchPriceFeed",
        message: "Update skipped because the last one for ancillary data was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        ancillaryData: ancillaryData,
        timeRemainingUntilUpdate: this.lastUpdateTime + this.minTimeBetweenUpdates - currentTime,
      });
      return;
    }

    this.logger.debug({
      at: "CryptoWatchPriceFeed",
      message: "Updating CryptoWatchPriceFeed",
      currentTime: currentTime,
      ancillaryData: ancillaryData,
      lastUpdateTimestamp: this.lastUpdateTime,
    });

    // Ancillary data might contain parameters that affect how we compute price, such as the twapLength.
    let twapLength = this.twapLength;
    if (ancillaryData) {
      const parsedAncillaryData = (parseAncillaryData(ancillaryData) as unknown) as SimplePriceAncillaryData;
      if (parsedAncillaryData.twapLength) {
        twapLength = Number(parsedAncillaryData.twapLength);
      }
    }

    // Round down to the nearest ohlc period so the queries captures the OHLC of the period *before* this earliest
    // timestamp (because the close of that OHLC may be relevant).
    const earliestHistoricalTimestamp =
      Math.floor((currentTime - (this.lookback + twapLength)) / this.ohlcPeriod) * this.ohlcPeriod;

    const newHistoricalPricePeriods = await this._getOhlcPricePeriods(earliestHistoricalTimestamp, currentTime);
    const newPrice = twapLength
      ? this._computeTwap(currentTime, newHistoricalPricePeriods, twapLength)
      : await this._getImmediatePrice();

    // 5. Store results.
    this.currentPrice = newPrice;
    this.historicalPricePeriods = newHistoricalPricePeriods;
    this.lastUpdateTime = currentTime;
    this.lastAncillaryData = ancillaryData;
  }

  private async _printVerbose(pricePeriod: PricePeriod, returnPrice: BN) {
    console.group(`\n(${this.exchange}:${this.pair}) Historical OHLC:`);
    console.log(
      `- openTime: ${pricePeriod.openTime}, closeTime: ${
        pricePeriod.closeTime
      }, openPrice: ${pricePeriod.openPrice.toString()}, closePrice: ${pricePeriod.closePrice.toString()}`
    );
    console.log(`- historicalTimestampBuffer: ${this.historicalTimestampBuffer}`);
    console.log(`- ✅ Matched Price: ${formatFixed(returnPrice.toString(), this.priceFeedDecimals)}`);
    console.log(
      `- ⚠️  If you want to manually verify the specific exchange prices, you can make a GET request to: \n- https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/ohlc?after=${pricePeriod.openTime}&before=${pricePeriod.closeTime}&periods=${this.ohlcPeriod}`
    );
    console.log(
      '- This will return an OHLC data packet as "result", which contains in order: \n- [CloseTime, OpenPrice, HighPrice, LowPrice, ClosePrice, Volume, QuoteVolume].'
    );
    console.log("- Note that you might need to invert the prices for certain identifiers like USDETH.");
    console.groupEnd();
    return;
  }

  private async _getImmediatePrice(): Promise<BN> {
    // See https://docs.cryptowat.ch/rest-api/markets/price for how this url is constructed.
    const priceUrl =
      `https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/price` +
      (this.apiKey ? `?apikey=${this.apiKey}` : "");

    const priceResponse = await this.networker.getJson(priceUrl);

    if (!priceResponse || !priceResponse.result || !priceResponse.result.price) {
      throw new Error(`🚨Could not parse price result from url ${priceUrl}: ${JSON.stringify(priceResponse)}`);
    }

    // Return data structure:
    // {
    //   "result": {
    //     "price": priceValue
    //   }
    // }
    return this.convertPriceFeedDecimals(priceResponse.result.price);
  }

  private async _getOhlcPricePeriods(
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<
    {
      openTime: number;
      closeTime: number;
      openPrice: BN;
      closePrice: BN;
    }[]
  > {
    // See https://docs.cryptowat.ch/rest-api/markets/ohlc for how this url is constructed.
    const ohlcUrl = [
      `https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/ohlc`,
      `?before=${toTimestamp}`,
      `&after=${fromTimestamp}`,
      `&periods=${this.ohlcPeriod}`,
      this.apiKey ? `&apikey=${this.apiKey}` : "",
    ].join("");

    const ohlcResponse = await this.networker.getJson(ohlcUrl);

    if (!ohlcResponse || !ohlcResponse.result || !ohlcResponse.result[this.ohlcPeriod]) {
      throw new Error(`🚨Could not parse ohlc result from url ${ohlcUrl}: ${JSON.stringify(ohlcResponse)}`);
    }

    // Return data structure:
    // {
    //   "result": {
    //     "OhlcInterval": [
    //     [
    //       CloseTime,
    //       OpenPrice,
    //       HighPrice,
    //       LowPrice,
    //       ClosePrice,
    //       Volume,
    //       QuoteVolume
    //     ],
    //     ...
    //     ]
    //   }
    // }
    // For more info, see: https://docs.cryptowat.ch/rest-api/markets/ohlc
    return (ohlcResponse.result[this.ohlcPeriod.toString()] as number[][])
      .map((ohlc: number[]) => ({
        // Output data should be a list of objects with only the open and close times and prices.
        openTime: ohlc[0] - this.ohlcPeriod,
        closeTime: ohlc[0],
        openPrice: this.convertPriceFeedDecimals(ohlc[1]),
        closePrice: this.convertPriceFeedDecimals(ohlc[4]),
      }))
      .sort((a, b) => {
        // Sorts the data such that the oldest elements come first.
        return a.openTime - b.openTime;
      });
  }

  private _computeTwap(
    endTime: number,
    ohlcs: { openTime: number; closeTime: number; openPrice: BN; closePrice: BN }[],
    twapLength: number
  ): BN | null {
    // Combine open and close to get more data fidelity at the edges of the range.
    const priceTimes = ohlcs
      .map((pricePeriod) => {
        return [
          [pricePeriod.openTime, pricePeriod.openPrice],
          [pricePeriod.closeTime, pricePeriod.closePrice],
        ] as [number, BN][];
      })
      .flat();
    const startTime = endTime - twapLength;
    const twapPrice = computeTWAP(priceTimes, startTime, endTime, this.web3.utils.toBN("0"));

    return twapPrice;
  }

  private _invertPriceSafely(priceBN: BN | null): BN | null {
    if (priceBN && !priceBN.isZero()) {
      return this.convertPriceFeedDecimals("1").mul(this.convertPriceFeedDecimals("1")).div(priceBN);
    } else {
      return null;
    }
  }
}
