#!/usr/bin/env node

/**
 * @notice This is an example script demonstrating how to get a historical price at a specific timestamp.
 * It could be used for example to query a price before committing a vote for a DVM price request.
 * We provide default configurations for querying median prices on specific markets across some exchanges and markets.
 * This script should serve as a template for constructing other historical median queries.
 *
 * @notice This script will fail if the `--time` is not within a the caller's configured lookback window. The caller
 * set this via the PRICEFEED_CONFIG={"lookback":x} environment variable.
 * @dev How to run:
 *     HARDHAT_NETWORK=mainnet ./src/local/getHistoricalPrice.js
 *         --network mainnet_mnemonic
 *         --identifier USDBTC
 *         --time 1601503200
 *         --ancillaryData 0x123abc
 */
const { web3 } = require("hardhat");
const { fromWei } = web3.utils;
const { createReferencePriceFeedForFinancialContract, Networker } = require("@uma/financial-templates-lib");
const winston = require("winston");
const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "time", "ancillaryData"] });
require("dotenv").config();

const UMIP_PRECISION = {
  USDBTC: 8,
  USDETH: 8,
  BTCDOM: 2,
  ALTDOM: 2,
  BCHNBTC: 8,
  "GASETH-TWAP-1Mx1M": 18,
  "USD-[bwBTC/ETH SLP]": 18,
  "USD/bBadger": 18,
  "STABLESPREAD/BTC": 8,
  "STABLESPREAD/USDC": 6,
  STABLESPREAD: 8,
  "ELASTIC_STABLESPREAD/USDC": 6,
  ETHBTC_FR: 9,
};
const DEFAULT_PRECISION = 18;

async function main() {
  // If user did not specify an identifier, provide a default value.
  let queryIdentifier;
  if (!argv.identifier) {
    queryIdentifier = "ETH/BTC";
    console.log(`Optional '--identifier' flag not specified, defaulting to: ${queryIdentifier}`);
  } else {
    queryIdentifier = argv.identifier;
  }

  // If user did not specify ancillary data, provide a default value.
  let queryAncillaryData;
  if (!argv.ancillaryData) {
    queryAncillaryData = "0x";
    console.log(`Optional '--ancillaryData' flag not specified, defaulting to: ${queryAncillaryData}`);
  } else {
    queryAncillaryData = argv.ancillaryData;
  }

  // Function to get the current time.
  const getTime = () => Math.round(new Date().getTime() / 1000);

  // If user specified a timestamp, then use it, otherwise default to the current time.
  let queryTime;
  if (!argv.time) {
    queryTime = getTime();
    console.log(
      `Optional '--time' flag not specified, defaulting to the current Unix timestamp (in seconds): ${queryTime}`
    );
  } else {
    queryTime = Number(argv.time);
  }
  console.log(`⏰ Fetching nearest prices for the timestamp: ${new Date(queryTime * 1000).toUTCString()}`);
  const lookback = Math.round(Math.max(getTime() - queryTime, 1800));

  // Create and update a new default price feed.
  let winstonFormat = winston.format.combine(winston.format.json(), winston.format.prettyPrint());
  let dummyLogger = winston.createLogger({
    level: "debug",
    format: winstonFormat,
    transports: [new winston.transports.Console()],
  });
  let priceFeedConfig = {
    // Empirically, Cryptowatch API only returns data up to ~4 days back so that's why we default the lookback
    // 1800.
    lookback,
    priceFeedDecimals: 18, // Ensure all prices come out as 18-decimal denominated so the fromWei conversion works at the end.
    // Append price feed config params from environment such as "apiKey" for CryptoWatch price feeds.
    ...(process.env.PRICE_FEED_CONFIG ? JSON.parse(process.env.PRICE_FEED_CONFIG) : {}),
  };
  const defaultPriceFeed = await createReferencePriceFeedForFinancialContract(
    dummyLogger,
    web3,
    new Networker(dummyLogger),
    getTime,
    null,
    priceFeedConfig,
    queryIdentifier
  );
  if (!defaultPriceFeed) {
    throw new Error(`Failed to construct default price feed for the ${queryIdentifier} identifier`);
  }

  await defaultPriceFeed.update();

  // The default exchanges to fetch prices for (and from which the median is derived) are based on UMIP's and can be found in:
  // protocol/financial-templates-lib/src/price-feed/CreatePriceFeed.js
  const queryPrice = await defaultPriceFeed.getHistoricalPrice(queryTime, queryAncillaryData, true);
  const precisionToUse = UMIP_PRECISION[queryIdentifier] ? UMIP_PRECISION[queryIdentifier] : DEFAULT_PRECISION;
  console.log(`\n⚠️ Truncating price to ${precisionToUse} decimals (default: 18)`);
  const [predec, postdec] = fromWei(queryPrice.toString()).split(".");
  const truncated = postdec ? [predec, postdec.slice(0, precisionToUse)].join(".") : predec;
  console.log(`\n💹 Median ${queryIdentifier} price @ ${queryTime} = ${truncated}`);
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
