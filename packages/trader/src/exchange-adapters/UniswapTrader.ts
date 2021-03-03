import winston from "winston";
import Web3 from "web3";
import BigNumber from "bignumber.js";
const truffleContract = require("@truffle/contract");

const { MAX_UINT_VAL } = require("@uma/common");
const ExchangeAdapterInterface = require("./ExchangeAdapterInterface");
const { getTruffleContract } = require("@uma/core");

const IUniswapV2Factory = require("@uniswap/v2-core/build/IUniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");

class UniswapTrader implements InstanceType<typeof ExchangeAdapterInterface> {
  readonly tradeDeadline: number;
  readonly UniswapBroker: any;
  uniswapPair: any;

  constructor(
    readonly logger: winston.Logger,
    readonly web3: Web3,
    readonly uniswapRouterAddress: string,
    readonly uniswapFactoryAddress: string,
    readonly tokenAAddress: string,
    readonly tokenBAddress: string,
    readonly dsProxyManager: any
  ) {
    this.logger = logger;
    this.web3 = web3;
    this.uniswapRouterAddress = uniswapRouterAddress;
    this.uniswapFactoryAddress = uniswapFactoryAddress;
    this.tokenAAddress = tokenAAddress;
    this.tokenBAddress = tokenBAddress;
    this.dsProxyManager = dsProxyManager;

    // TODO: add this as a parameter when configuring the uniswap trader.
    this.tradeDeadline = 10 * 60 * 60;

    this.UniswapBroker = getTruffleContract("UniswapBroker", this.web3);
  }
  async tradeMarketToDesiredPrice(desiredPrice: BigNumber) {
    const callCode = this.UniswapBroker.bytecode;

    const contract = new this.web3.eth.Contract(this.UniswapBroker.abi);

    const callData = contract.methods
      .swapToPrice(
        false, // tradingAsEOA. Set as false as this is executed as a DSProxy.
        this.uniswapRouterAddress,
        this.uniswapFactoryAddress,
        [this.tokenAAddress, this.tokenBAddress], // swappedTokens: The two exchanged
        [desiredPrice.toString(), this.web3.utils.toWei("1").toString()], // truePriceTokens: ratio between these is the "true" price
        [MAX_UINT_VAL, MAX_UINT_VAL], // maxSpendTokens: We dont want to limit how many tokens can be pulled.
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

  async getExchangeSpotPrice() {
    if (!this.uniswapPair) {
      const uniswapFactory = await this.createContractObjectFromJson(IUniswapV2Factory).at(this.uniswapFactoryAddress);
      const pairAddress = await uniswapFactory.getPair(this.tokenBAddress, this.tokenAAddress);
      this.uniswapPair = await this.createContractObjectFromJson(IUniswapV2Pair).at(pairAddress);
    }

    const reserves = await this.uniswapPair?.getReserves();

    return reserves.reserve1.mul(this.web3.utils.toBN(this.web3.utils.toWei("1"))).div(reserves.reserve0);
  }

  // TODO: This method was pulled from the uniswapBroker tests. it should be refactored to work with generic implementations.
  // potentially the getTruffleContract method should be modified to enable creation of truffle contracts from json
  // as a fallback keeping the getter interface generic.
  createContractObjectFromJson(contractJsonObject: { [key: string]: string }) {
    const truffleContractCreator = truffleContract(contractJsonObject);
    truffleContractCreator.setProvider(this.web3.currentProvider);
    return truffleContractCreator;
  }
}

module.exports = { UniswapTrader };
