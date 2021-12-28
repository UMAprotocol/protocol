import winston from "winston";
import Web3 from "web3";
import BigNumber from "bignumber.js";

import { encodePriceSqrt } from "@uma/common";
import ExchangeAdapterInterface from "./ExchangeAdapterInterface";
import { getAbi, getBytecode } from "@uma/contracts-node";
import type { TransactionReceipt } from "web3-core";
import type { DSProxyManager } from "@uma/financial-templates-lib";

export class UniswapV3Trader implements ExchangeAdapterInterface {
  readonly tradeDeadline: number;
  readonly UniswapV3Broker: { abi: any; bytecode: string };

  constructor(
    readonly logger: winston.Logger,
    readonly web3: Web3,
    readonly uniswapPoolAddress: string,
    readonly uniswapRouterAddress: string,
    readonly dsProxyManager: DSProxyManager
  ) {
    this.tradeDeadline = 10 * 60 * 60;
    this.UniswapV3Broker = { abi: getAbi("UniswapV3Broker"), bytecode: getBytecode("UniswapV3Broker") };
  }
  async tradeMarketToDesiredPrice(desiredPrice: BigNumber): Promise<Error | TransactionReceipt> {
    const callCode = this.UniswapV3Broker.bytecode;

    const contract = new this.web3.eth.Contract(this.UniswapV3Broker.abi);

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
      return error as Error;
    }
  }
}
