import winston from "winston";
import Web3 from "web3";

const assert = require("assert");
const { UniswapTrader } = require("./UniswapTrader");

async function createExchangeAdapter(
  logger: winston.Logger,
  web3: Web3,
  dsProxyManager: any,
  config: any,
  networkId: number
) {
  assert(config.type, "Exchange adapter must have a type. EG uniswap for a uniswap dex");

  if (config.type === "uniswap") {
    const requiredFields = ["tokenAAddress", "tokenBAddress"];
    if (isMissingField(config, requiredFields, logger)) return null;

    // TODO: refactor these to be pulled from a constants file somewhere.
    const uniswapAddresses: { [key: number]: { router: string; factory: string } } = {
      1: {
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
      },
      42: {
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
      }
    };
    config = {
      uniswapRouterAddress: uniswapAddresses[networkId].router,
      uniswapFactoryAddress: uniswapAddresses[networkId].factory,
      ...config
    };

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

// TODO: this method was taken verbatim from the create price feed class. it should be refactored to a common util.
function isMissingField(config: { [key: string]: string }, requiredFields: Array<string>, logger: winston.Logger) {
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
