import Web3 from "web3";
import { PriceFeedInterface } from "./PriceFeedInterface";
import { parseFixed } from "@ethersproject/bignumber";
import { BN } from "../types";
const { toBN } = Web3.utils;

// Adds a final precision conversion step to the PriceFeedMock before returning prices.
export class PriceFeedMockScaled extends PriceFeedInterface {
  public updateCalled = 0;
  public uuid: string;
  public historicalPrices: { [timestamp: number]: BN | null } = {};
  public convertDecimals: (number: number | BN | string) => BN;
  constructor(
    public currentPrice: BN | null = null,
    public historicalPrice: BN | null = null,
    public lastUpdateTime: number | null = null,
    public priceFeedDecimals = 18,
    public lookback: number | null = 3600
  ) {
    super();
    this.historicalPrices = [];
    this.uuid = "PriceFeedMockScaled";

    this.convertDecimals = (number) => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number
      return toBN(parseFixed(number.toString(), priceFeedDecimals).toString());
    };

    // Initialize state prices using specified precision
    this.setCurrentPrice(currentPrice);
    this.setHistoricalPrice(historicalPrice);
  }

  public setCurrentPrice(currentPrice: null | BN): void {
    // allows this to be set to null without throwing.
    this.currentPrice = currentPrice ? this.convertDecimals(currentPrice) : currentPrice;
  }

  // Store an array of historical prices [{timestamp, price}] so that await  getHistoricalPrice can return
  // a price for a specific timestamp if found in this array.
  public setHistoricalPrices(historicalPrices: { timestamp: number; price: BN | null }[]): void {
    historicalPrices.forEach((_price) => {
      if (isNaN(_price.timestamp)) {
        throw "Invalid historical price => [{timestamp, price}]";
      }
      // allows this to be set to null without throwing.
      this.historicalPrices[_price.timestamp] = _price.price ? this.convertDecimals(_price.price) : _price.price;
    });
  }

  public setHistoricalPrice(historicalPrice: BN | null): void {
    this.historicalPrice = historicalPrice ? this.convertDecimals(historicalPrice) : historicalPrice;
  }

  public setLastUpdateTime(lastUpdateTime: number | null): void {
    this.lastUpdateTime = lastUpdateTime;
  }

  public setLookback(lookback: number | null): void {
    this.lookback = lookback;
  }

  public getCurrentPrice(): BN | null {
    return this.currentPrice;
  }

  public async getHistoricalPrice(time: number, ancillaryData: string): Promise<BN | null> {
    // To implement the PriceFeedInterface properly, this method must either return a valid price
    // or throw.
    if (!this.historicalPrice && !(time in this.historicalPrices) && !ancillaryData) {
      throw new Error("PriceFeedMock expected error thrown");
    } else {
      // If a price for `time` was set via `setHistoricalPrices`, then return that price, otherwise return the mocked
      // historical price.
      if (time in this.historicalPrices) {
        return this.historicalPrices[time];
      } else {
        return this.historicalPrice;
      }
    }
  }

  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }

  public getLookback(): number | null {
    return this.lookback;
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }

  public async update(): Promise<void> {
    this.updateCalled++;
  }
}
