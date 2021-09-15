import { PriceFeedInterface } from "./PriceFeedInterface";
import type Web3 from "web3";
import type { Logger } from "winston";
import type { BN } from "../types";

// Simulates a pricefeed with bad data
export class InvalidPriceFeedMock extends PriceFeedInterface {
  private currentPrice: BN | null = null;
  private lastUpdateTime: number | null = null;
  constructor(
    private readonly logger?: Logger,
    private readonly web3?: Web3,
    private readonly getTime?: () => Promise<number>,
    private readonly shouldUpdateThrow = false,
    private readonly priceFeedDecimals = 18
  ) {
    super();

    this.currentPrice = null;
    this.lastUpdateTime = null;
  }
  public async getHistoricalPrice(): Promise<BN> {
    throw new Error("InvalidPriceFeedMock: expected missing historical price");
  }
  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }
  public setLastUpdateTime(lastUpdateTime: number): void {
    this.lastUpdateTime = lastUpdateTime;
  }
  public getCurrentPrice(): BN | null {
    return null;
  }
  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }
  public async update(): Promise<void> {
    if (this.shouldUpdateThrow) {
      throw new Error("InvalidPriceFeedMock: expected update failure");
    }
  }
  public getLookback(): number {
    return 0;
  }
}
