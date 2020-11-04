const { createReferencePriceFeedForEmp, Networker } = require("@uma/financial-templates-lib");
const winston = require("winston");

// TODO: refactor this to inject web3 into the module from the caller.
// const { getWeb3 } = require("@uma/common");
// const web3 = getWeb3();

const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));

module.exports = () => {
  async function getHistoricSynthPrice(empAddress, from, to) {
    console.log("GETTING");
    // TODO: change createReferencePriceFeedForEmp to allow a null or undefined logger instead of forcing the caller
    // to provide a silent logger.
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
    console.log("priceFeed", priceFeed);

    await priceFeed.update();
    const currentPrice = priceFeed.getCurrentPrice();
    console.log("currentPrice", currentPrice.toString());
    const historicalPricePeriods = priceFeed.getHistoricalPricePeriods();

    historicalPricePeriods.forEach(price => {
      console.log(`time: ${price[0]},price: ${price[1]}`);
    });
  }
  return { getHistoricSynthPrice };
};
