const { createReferencePriceFeedForEmp, Networker } = require("@uma/financial-templates-lib");
const winston = require("winston");

// TODO: refactor this to inject web3 into the module from the caller.
// const { getWeb3 } = require("@uma/common");
// const web3 = getWeb3();

const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));

module.exports = () => {
  // Fetch historic synthetic prices for a given `empAddress` between timestamps `from` and `to.
  // Note timestamps are assumed to be js timestamps and are converted to unixtimestamps by dividing by 1000.
  async function getHistoricSynthPrice(empAddress, from, to) {
    from = from / 1000;
    to = to / 1000;
    const priceFeed = await createReferencePriceFeedForEmp(
      winston.createLogger({ transports: [new winston.transports.Console()] }),
      web3,
      new Networker(),
      () => to, // starting time
      empAddress,
      { lookback: to - from, ohlcPeriod: 900 } // price feed config. Use lookback to offset the from -> to
    );

    await priceFeed.update();
    return priceFeed.getHistoricalPricePeriods();
  }
  return { getHistoricSynthPrice };
};
