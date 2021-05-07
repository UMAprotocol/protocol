import winston from "winston";
import Web3 from "web3";
import BigNumber from "bignumber.js";

const { encodePriceSqrt } = require("@uma/common");
const ExchangeAdapterInterface = require("./ExchangeAdapterInterface");
const { getTruffleContract } = require("@uma/core");

class UniswapV3Trader implements InstanceType<typeof ExchangeAdapterInterface> {
  readonly tradeDeadline: number;
  readonly UniswapV2Broker: any;
  uniswapPair: any;

  constructor(
    readonly logger: winston.Logger,
    readonly web3: Web3,
    readonly uniswapPoolAddress: string,
    readonly uniswapRouterAddress: string,
    readonly dsProxyManager: any
  ) {
    this.logger = logger;
    this.web3 = web3;
    this.uniswapPoolAddress = uniswapPoolAddress;
    this.uniswapRouterAddress = uniswapRouterAddress;

    this.dsProxyManager = dsProxyManager;

    this.tradeDeadline = 10 * 60 * 60;

    this.UniswapV2Broker = getTruffleContract("UniswapV3Broker", this.web3);
  }
  async tradeMarketToDesiredPrice(desiredPrice: BigNumber) {
    console.log("desiredPrice", desiredPrice.toString());
    const callCode = this.UniswapV2Broker.bytecode;

    const contract = new this.web3.eth.Contract(this.UniswapV2Broker.abi);

    const callData = contract.methods
      .swapToPrice(
        false, // tradingAsEOA. Set as false as this is executed as a DSProxy.
        this.uniswapPoolAddress, // address of the pool to uniswap v3 trade against.
        this.uniswapRouterAddress, // address of the uniswap v3 router to route the trade.
        encodePriceSqrt(desiredPrice, this.web3.utils.toWei("1")), // sqrtRatioTargetX96 target, encoded price.
        this.dsProxyManager.getDSProxyAddress(), // to: the output of the trade will send the tokens to the DSProxy.
        Number((await this.web3.eth.getBlock("latest")).timestamp) + this.tradeDeadline // Deadline in the future
      )
      .encodeABI();

    try {
      return await this.dsProxyManager.callFunctionOnNewlyDeployedLibrary(callCode, callData);
    } catch (error) {
      return error;
    }
  }
}

module.exports = { UniswapV3Trader };
