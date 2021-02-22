const assert = require("assert");

const { UniswapTrader } = require("./UniswapTrader");

async function createExchangeAdapter(logger: any, web3: any, dsProxyManager: any, config: any) {
  console.log("config", config);
  assert(config.type, "Exchange adapter must have a type. EG uniswap for a uniswap dex");

  if (config.type === "uniswap") {
    const requiredFields = ["tokenA", "tokenB"];
    if (isMissingField(config, requiredFields, logger)) return null;

    // TODO: refactor these to be pulled from a constants file somewhere.
    const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const uniswapFactoryAddress = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
    config = { uniswapRouterAddress, uniswapFactoryAddress, ...config };

    return new UniswapTrader(
      logger,
      web3,
      config.uniswapRouterAddress,
      config.uniswapFactoryAddress,
      config.tokenAAddress,
      config.tokenBAddress,
      dsProxyManager
    );
  }
  return null;
}

function isMissingField(config: any, requiredFields: Array<string>, logger: any) {
  const missingField = requiredFields.find(field => config[field] === undefined);
  if (missingField !== undefined) {
    logger.error({
      at: "createPriceFeed",
      message: "Config is missing field🚨",
      priceFeedType: config.type,
      requiredFields,
      missingField,
      config
    });
    return true;
  }

  return false;
}

module.exports = { createExchangeAdapter };
