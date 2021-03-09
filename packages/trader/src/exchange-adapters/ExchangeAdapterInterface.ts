import BigNumber from "bignumber.js";
export default interface ExchangeAdapterInterface {
  // Take in a desired price and execute the trades required to move the market from the current price to desiredPrice.
  tradeMarketToDesiredPrice(desiredPrice: BigNumber): void;
}
