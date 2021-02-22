export interface PriceFeed {
  [key: string]: any;
}

export class RangeTrader {
  readonly tokenPriceFeed: any;
  readonly referencePriceFeed: any;

  constructor(tokenPriceFeed: PriceFeed, referencePriceFeed: PriceFeed) {
    this.tokenPriceFeed = tokenPriceFeed;
    this.referencePriceFeed = referencePriceFeed;
  }

  async function();
}

module.exports = { RangeTrader };
