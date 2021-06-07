// ignore this file for now, its a work in progress. pulled from affiliates synthPrices
import { createReferencePriceFeedForFinancialContract, Networker } from "@uma/financial-templates-lib";
import winston from "winston";
import assert from "assert";
import type Web3 from "web3";

type Config = {
  cryptowatchApiKey?: string;
  tradermadeApiKey?: string;
  decimals?: number;
};
type Dependencies = {
  web3: Web3;
};

export default ({ cryptowatchApiKey, tradermadeApiKey, decimals = 18 }: Config = {}, { web3 }: Dependencies) => {
  const logger = winston.createLogger({
    transports: [
      new winston.transports.Console({
        level: "error",
        stderrLevels: ["error"],
      }),
    ],
  });
  const networker = new Networker(logger);
  // Fetch historic synthetic prices for a given `empAddress` between timestamps `from` and `to.
  // Note timestamps are assumed to be js timestamps and are converted to unixtimestamps by dividing by 1000.
  async function getCurrentPrice(empAddress: string, now = Date.now()) {
    const priceFeed: any = await createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      () => now / 1000, // starting time in seconds
      empAddress,
      { priceFeedDecimals: decimals, cryptowatchApiKey, tradermadeApiKey }
    );

    assert(priceFeed, "Create Reference price feed for emp returned an undefined value");
    await priceFeed.update();
    return Promise.all([priceFeed.getLastUpdateTime(), priceFeed.getCurrentPrice()]);
  }
  return { getCurrentPrice };
};
