const { createReferencePriceFeedForFinancialContract, Networker } = require("@uma/financial-templates-lib");
const winston = require("winston");
const assert = require("assert");

module.exports = ({ web3, apiKey, decimals = 18 } = {}) => {
  // Fetch historic synthetic prices for a given `empAddress` between timestamps `from` and `to.
  // Note timestamps are assumed to be js timestamps and are converted to unixtimestamps by dividing by 1000.
  async function getHistoricSynthPrices(empAddress, from, to) {
    from = from / 1000;
    to = to / 1000;
    const priceFeed = await createReferencePriceFeedForFinancialContract(
      winston.createLogger({ transports: [new winston.transports.Console()] }),
      web3,
      new Networker(),
      () => to, // starting time
      empAddress,
      { priceFeedDecimals: decimals, lookback: to - from, ohlcPeriod: 900, apiKey } // price feed config. Use lookback to offset the from -> to
    );

    assert(priceFeed, "Create Reference price feed for emp returned an undefined value");
    await priceFeed.update();
    return priceFeed.getHistoricalPricePeriods();
  }
  return { getHistoricSynthPrices };
};
