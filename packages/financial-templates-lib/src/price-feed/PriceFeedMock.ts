import { PriceFeedInterface } from "./PriceFeedInterface";
import Web3 from "web3";
import { BN } from "../types";
const { toBN } = Web3.utils;

export class PriceFeedMock extends PriceFeedInterface {
  public updateCalled: number;
  public historicalPrices: (BN | null)[];
  private readonly uuid: string;

  constructor(
    public currentPrice: BN | null = null,
    public historicalPrice: BN | null = null,
    public lastUpdateTime: number | null = null,
    public priceFeedDecimals = 18,
    public lookback: number | null = 3600
  ) {
    super();
    this.updateCalled = 0;
    this.currentPrice = currentPrice;
    this.historicalPrice = historicalPrice;
    this.lastUpdateTime = lastUpdateTime;
    this.priceFeedDecimals = priceFeedDecimals;
    this.historicalPrices = [];
    this.lookback = lookback;
    this.uuid = "PriceFeedMock";
  }

  public setCurrentPrice(currentPrice: BN | string | number | null): void {
    // allows this to be set to null without throwing.
    this.currentPrice = currentPrice !== null ? toBN(currentPrice.toString()) : currentPrice;
  }

  // Store an array of historical prices [{timestamp, price}] so that await  getHistoricalPrice can return
  // a price for a specific timestamp if found in this array.
  public setHistoricalPrices(historicalPrices: { timestamp: number; price: BN | string | number | null }[]): void {
    historicalPrices.forEach((_price) => {
      if (isNaN(_price.timestamp)) {
        throw "Invalid historical price => [{timestamp, price}]";
      }
      // allows this to be set to null without throwing.
      this.historicalPrices[_price.timestamp] =
        _price.price !== null && _price.price !== undefined ? toBN(_price.price.toString()) : _price.price;
    });
  }

  public setHistoricalPrice(historicalPrice: BN | string | number | null): void {
    this.historicalPrice = historicalPrice !== null ? toBN(historicalPrice.toString()) : historicalPrice;
  }

  public setLastUpdateTime(lastUpdateTime: number | null): void {
    this.lastUpdateTime = lastUpdateTime;
  }

  public setLookback(lookback: number | null): void {
    this.lookback = lookback;
  }

  public getCurrentPrice(): BN | null {
    return this.currentPrice || null;
  }

  public async getHistoricalPrice(time: number): Promise<BN | null> {
    // To implement the PriceFeedInterface properly, this method must either return a valid price
    // or throw.
    if (!this.historicalPrice && !(time in this.historicalPrices)) {
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
    return this.lastUpdateTime || null;
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
