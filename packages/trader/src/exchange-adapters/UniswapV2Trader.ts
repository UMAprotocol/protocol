import winston from "winston";
import Web3 from "web3";
import BigNumber from "bignumber.js";

import { MAX_UINT_VAL } from "@uma/common";
import ExchangeAdapterInterface from "./ExchangeAdapterInterface";
import { getTruffleContract } from "@uma/core";

export class UniswapV2Trader implements ExchangeAdapterInterface {
  readonly tradeDeadline: number;
  readonly UniswapV2Broker: any;
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
    this.tradeDeadline = 10 * 60 * 60;

    this.UniswapV2Broker = getTruffleContract("UniswapV2Broker", this.web3 as any);
  }
  async tradeMarketToDesiredPrice(desiredPrice: BigNumber) {
    const callCode = this.UniswapV2Broker.bytecode;

    const contract = new this.web3.eth.Contract(this.UniswapV2Broker.abi);

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
}
