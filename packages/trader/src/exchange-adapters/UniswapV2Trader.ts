import winston from "winston";
import Web3 from "web3";
import BigNumber from "bignumber.js";

import { MAX_UINT_VAL } from "@uma/common";
import ExchangeAdapterInterface from "./ExchangeAdapterInterface";
import { getAbi, getBytecode } from "@uma/contracts-node";
import type { DSProxyManager } from "@uma/financial-templates-lib";
import type { TransactionReceipt } from "web3-core";

export class UniswapV2Trader implements ExchangeAdapterInterface {
  readonly tradeDeadline: number;
  readonly UniswapV2Broker: { abi: any; bytecode: string };
  uniswapPair: any;

  constructor(
    readonly logger: winston.Logger,
    readonly web3: Web3,
    readonly uniswapRouterAddress: string,
    readonly uniswapFactoryAddress: string,
    readonly tokenAAddress: string,
    readonly tokenBAddress: string,
    readonly dsProxyManager: DSProxyManager
  ) {
    this.tradeDeadline = 10 * 60 * 60;

    this.UniswapV2Broker = { abi: getAbi("UniswapV2Broker"), bytecode: getBytecode("UniswapV2Broker") };
  }
  async tradeMarketToDesiredPrice(desiredPrice: BigNumber): Promise<Error | TransactionReceipt> {
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
      return error as Error;
    }
  }
}
