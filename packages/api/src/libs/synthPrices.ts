import { createReferencePriceFeedForFinancialContract, Networker } from "@uma/financial-templates-lib";
import winston from "winston";
import assert from "assert";
import type Web3 from "web3";

type Config = {
  cryptowatchApiKey?: string;
  tradermadeApiKey?: string;
  quandlApiKey?: string;
  defipulseApiKey?: string;
  priceFeedDecimals?: number;
};

// cannot get type of Pricefeed, would be great if we could
type PriceFeed = any;

export default (config: Config = {}, web3: Web3) => {
  const logger = winston.createLogger({
    transports: [
      new winston.transports.Console({
        level: "error",
        stderrLevels: ["error"],
      }),
    ],
  });
  const networker = new Networker(logger);
  // Fetch current price for a given `empAddress`
  async function getCurrentPrice(empAddress: string, now = Date.now()) {
    const priceFeed: PriceFeed = await createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      async () => Math.floor(now / 1000), // starting time in seconds
      empAddress,
      {
        // default to 18 decimals
        priceFeedDecimals: 18,
        ...config,
      }
    );

    assert(priceFeed, `${empAddress}: SynthPrice.getCurrentPrice returned undefined value`);
    await priceFeed.update();

    const result: [number, string] = [Number(priceFeed.getLastUpdateTime()), priceFeed.getCurrentPrice().toString()];

    return result;
  }
  return { getCurrentPrice };
};
