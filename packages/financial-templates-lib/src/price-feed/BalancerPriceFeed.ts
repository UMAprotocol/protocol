import assert from "assert";
import { PriceFeedInterface } from "./PriceFeedInterface";
import { BlockHistory, PriceHistory, computeTWAP } from "./utils";
import { ConvertDecimals } from "@uma/common";
import { BalancerWeb3 } from "@uma/contracts-node";
import type { Logger } from "winston";
import Web3 from "web3";
import { Abi, BN } from "../types";
import type { BlockTransactionString } from "web3-eth";

// Note: there is no way to do something like typeof SomeGenericType<SomeGenericParameter>, so we have to trick the
// compiler into generating a type by creating a fake function that returns it.
const _blockHistoryGenericWorkaround = (arg: (blockNumber?: number) => Promise<BlockTransactionString>) =>
  BlockHistory<BlockTransactionString>(arg);
const _priceHistoryGenericWorkaround = (arg: (number: number) => Promise<BN | null>) => PriceHistory<BN>(arg);

// Gets balancer spot and historical prices. This price feed assumes that it is returning
// prices as 18 decimals of precision, so it will scale up the pool's price as reported by Balancer contracts
// if the user specifies that the Balancer contract is returning non-18 decimal precision prices.
export class BalancerPriceFeed extends PriceFeedInterface {
  public readonly contract: BalancerWeb3;
  public readonly uuid: string;
  private readonly toBN = Web3.utils.toBN;
  private currentPrice: BN | null = null;
  private lastUpdateTime: number | null = null;
  private readonly getLatestBlock: (blockNumber?: number) => Promise<BlockTransactionString>;
  private readonly blockHistory: ReturnType<typeof _blockHistoryGenericWorkaround>;
  private readonly priceHistory: ReturnType<typeof _priceHistoryGenericWorkaround>;
  private readonly convertPoolDecimalsToPriceFeedDecimals: ReturnType<typeof ConvertDecimals>;

  constructor(
    private readonly logger: Logger,
    public readonly web3: Web3,
    private readonly getTime: () => Promise<number>,
    abi: Abi,
    address: string,
    private readonly tokenIn: string,
    private readonly tokenOut: string,
    public readonly lookback: number,
    public readonly twapLength: number,
    private readonly poolDecimals = 18,
    private readonly priceFeedDecimals = 18
  ) {
    super();
    assert(tokenIn, "BalancerPriceFeed requires tokenIn");
    assert(tokenOut, "BalancerPriceFeed requires tokenOut");
    assert(lookback >= 0, "BalancerPriceFeed requires lookback >= 0");
    assert(twapLength >= 0, "BalancerPriceFeed requires lookback >= 0");

    // TODO: Should/Can we read in `poolDecimals` from this.contract?
    this.contract = (new web3.eth.Contract(abi, address) as unknown) as BalancerWeb3;
    this.uuid = `Balancer-${address}`;
    this.getLatestBlock = (blockNumber?: number) =>
      web3.eth.getBlock(blockNumber !== undefined ? blockNumber : "latest");
    // Provide a getblock function which returns the latest value if no number provided.
    this.blockHistory = BlockHistory(this.getLatestBlock);

    // Add a callback to get price, error can be thrown from web3 disconection or maybe something else
    // which affects the update call.
    this.priceHistory = PriceHistory(async (number: number) => {
      try {
        const bPoolPrice = this.toBN(
          await this.contract.methods.getSpotPriceSansFee(this.tokenIn, this.tokenOut).call(undefined, number)
        );
        // Like the Uniswap price feed, if pool price is 0, then return null
        if (!bPoolPrice.isZero()) {
          return bPoolPrice;
        } else {
          return null;
        }
      } catch (err) {
        // Like the UniswapPriceFeed, when the price is unavailable then return null instead of throwing.
        return null;
      }
    });

    // Convert _bn precision from poolDecimals to desired decimals by scaling up or down based
    // on the relationship between pool precision and the desired decimals.
    this.convertPoolDecimalsToPriceFeedDecimals = ConvertDecimals(this.poolDecimals, this.priceFeedDecimals);
  }

  public async getHistoricalPrice(time: number): Promise<BN> {
    if (this.lastUpdateTime && time < this.lastUpdateTime - this.lookback) {
      // Requesting an historical TWAP earlier than the lookback.
      throw new Error(`${this.uuid} time ${time} is earlier than TWAP window`);
    }

    let historicalPrice;
    if (this.twapLength === 0) {
      historicalPrice = this.getSpotPrice(time);
    } else {
      historicalPrice = this._computeTwap(time - this.twapLength, time);
    }

    if (historicalPrice) {
      return this.convertPoolDecimalsToPriceFeedDecimals(historicalPrice);
    } else {
      throw new Error(`${this.uuid} missing historical price @ time ${time}`);
    }
  }

  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }

  public getLookback(): number {
    return this.lookback;
  }

  public getCurrentPrice(): BN | null {
    let currentPrice;
    // If twap window is 0, then return last price
    if (this.twapLength === 0) {
      currentPrice = this.getSpotPrice();
    } else {
      const lastUpdateTime = this.lastUpdateTime || 0;
      currentPrice = this._computeTwap((lastUpdateTime || 0) - this.twapLength, lastUpdateTime);
    }
    return currentPrice && this.convertPoolDecimalsToPriceFeedDecimals(currentPrice);
  }
  // Not part of the price feed interface. Can be used to pull the balancer price at the most recent block.
  // If `time` is undefined, return latest block price.
  public getSpotPrice(time?: number): BN | null {
    if (!time) {
      const currentPrice = this.priceHistory.currentPrice();
      return currentPrice && this.convertPoolDecimalsToPriceFeedDecimals(currentPrice);
    } else {
      // We want the block and price equal to or before this time
      const block = this.blockHistory.getClosestBefore(time);
      if (block == null) return null;
      if (!this.priceHistory.has(Number(block.timestamp))) {
        return null;
      }
      return (
        this.priceHistory.get(Number(block.timestamp)) &&
        this.convertPoolDecimalsToPriceFeedDecimals(this.priceHistory.get(Number(block.timestamp)))
      );
    }
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }

  public async update(): Promise<void> {
    const currentTime = await this.getTime();
    this.logger.debug({
      at: "BalancerPriceFeed",
      message: "Updating BalancerPriceFeed",
      lastUpdateTimestamp: currentTime,
    });
    let blocks = [];
    // disabled lookback by setting it to 0
    if (this.lookback === 0) {
      // handle no lookback, we just want to insert the latest block into the blockHistory.
      const block = await this.getLatestBlock();
      this.blockHistory.insert(block);
      blocks = this.blockHistory.listBlocks();
    } else {
      // handle historical lookback. Have to be careful your lookback time gives a big enough
      // window to find a single block, otherwise you will have errors. This essentially maps
      // blockHistory.insert() over all blocks in the lookback window.
      blocks = await this.blockHistory.update(this.lookback + this.twapLength, currentTime);
    }
    // The priceHistory.update() method should strip out any blocks where the price is null
    await Promise.all(blocks.map(this.priceHistory.update));

    this.lastUpdateTime = currentTime;
  }
  // If priceHistory only encompasses 1 block, which happens if the `lookback` window is 0,
  // then this should return the last and only price.
  private _computeTwap(startTime: number, endTime: number): BN | null {
    const events = this.priceHistory.list().slice();
    return computeTWAP(events, startTime, endTime, this.toBN("0"));
  }
}
