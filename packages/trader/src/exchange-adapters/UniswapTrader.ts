import Web3 from "web3";
import assert from "assert";
const { ExchangeAdapterInterface } = require("./ExchangeAdapterInterface");

class UniswapTrader extends ExchangeAdapterInterface {
  readonly logger: any;
  readonly web3: any;
  readonly uniswapRouterAddress: string;
  readonly uniswapFactoryAddress: string;
  readonly tokenAAddress: string;
  readonly tokenBAddress: string;
  readonly dsProxyManager: any;
  constructor(
    logger: any,
    web3: any,
    uniswapRouterAddress: string,
    uniswapFactoryAddress: string,
    tokenAAddress: string,
    tokenBAddress: string,
    dsProxyManager: any
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.uniswapRouterAddress = uniswapRouterAddress;
    this.uniswapFactoryAddress = uniswapFactoryAddress;
    this.tokenAAddress = tokenAAddress;
    this.tokenBAddress = tokenBAddress;
    this.dsProxyManager = dsProxyManager;
  }
  async tradeMarketToDesiredPrice() {
    // TODO: implement logic to integrate with UniswapBroker to trade the market up and down.
  }
}

module.exports = { UniswapTrader };
