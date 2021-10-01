// An implementation of PriceFeedInterface that uses a Uniswap v2 TWAP as the price feed source.

import { PriceFeedInterface } from "./PriceFeedInterface";
import { computeTWAP } from "./utils";
import { ConvertDecimals, averageBlockTimeSeconds, parseFixed } from "@uma/common";
import type { Logger } from "winston";
import Web3 from "web3";
const { toBN } = Web3.utils;
import { UniswapV2Web3, UniswapV3Web3, ERC20Web3 } from "@uma/contracts-frontend";
import { BN, Abi } from "../types";
import { EventData } from "web3-eth-contract";

interface UniswapEvent {
  timestamp: number;
  blockNumber: number;
  price?: BN;
}

type UniswapEventWithPrice = Required<UniswapEvent>;

interface Block {
  timestamp: number;
  number: number;
}

export abstract class UniswapPriceFeed extends PriceFeedInterface {
  protected readonly uniswap: UniswapV2Web3 | UniswapV3Web3;
  private token0: ERC20Web3 | null = null;
  private token1: ERC20Web3 | null = null;
  protected readonly uuid: string;
  private readonly bufferBlockPercent: number = 1.1;
  private currentTwap: BN | null = null;
  private convertToPriceFeedDecimals: ReturnType<typeof ConvertDecimals> | null = null;
  private lastUpdateTime: number | null = null;
  private events: UniswapEventWithPrice[] = [];
  private lastBlockPrice: BN | null = null;
  protected token0Precision: number | null = null;
  protected token1Precision: number | null = null;

  /**
   * @notice Constructs new uniswap TWAP price feed object.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} uniswapAbi Uniswap Market Truffle ABI object to create a contract instance to query prices.
   * @param {Object} erc20Abi ERC20 Token Truffle ABI object to create a contract instance to query decimals.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} uniswapAddress Ethereum address of the Uniswap market the price feed is monitoring.
   * @param {Integer} twapLength Duration of the time weighted average computation used by the price feed.
   * @param {Integer} historicalLookback How far in the past historical prices will be available using getHistoricalPrice.
   * @param {Function} getTime Returns the current time.
   * @param {Bool} invertPrice Indicates if the Uniswap pair is computed as reserve0/reserve1 (true) or reserve1/reserve0 (false).
   * @param {Integer} priceFeedDecimals Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor(
    private readonly logger: Logger,
    uniswapAbi: Abi,
    private readonly erc20Abi: Abi,
    private readonly web3: Web3,
    uniswapAddress: string,
    private readonly twapLength: number,
    private readonly historicalLookback: number,
    private readonly getTime: () => Promise<number>,
    protected readonly invertPrice: boolean,
    private readonly priceFeedDecimals = 18,
    private blocks: { [blockNumber: number]: Promise<Block> } = {}
  ) {
    super();

    // Create Uniswap contract
    this.uniswap = (new web3.eth.Contract(uniswapAbi, uniswapAddress) as unknown) as UniswapV2Web3 | UniswapV3Web3;
    this.uuid = `Uniswap-${uniswapAddress}`;
    // The % of the lookback window (historicalLookback + twapLength) that we want to query for Uniswap
    // Sync events. For example, 1.1 = 110% meaning that we'll look back 110% * (historicalLookback + twapLength)
    // seconds, in blocks, for Sync events.
    this.bufferBlockPercent = 1.1;
  }

  public getCurrentPrice(): BN | null {
    return this.currentTwap && this.convertToPriceFeedDecimals && this.convertToPriceFeedDecimals(this.currentTwap);
  }

  public async getHistoricalPrice(time: number): Promise<BN> {
    if (!this.lastUpdateTime || !this.convertToPriceFeedDecimals)
      throw new Error(`${this.uuid} -- Haven't called update() yet`);
    if (time < this.lastUpdateTime - this.historicalLookback) {
      // Requesting an historical TWAP earlier than the lookback.
      throw new Error(`${this.uuid} time ${time} is earlier than TWAP window`);
    }

    const historicalPrice = this._computeTwap(this.events, time - this.twapLength, time);
    if (historicalPrice) {
      return this.convertToPriceFeedDecimals(historicalPrice);
    } else {
      throw new Error(`${this.uuid} missing historical price @ time ${time}`);
    }
  }

  // This function does not return the same type of price data as getHistoricalPrice. It returns the raw
  // price history from uniswap without a twap. This is by choice, since a twap calculation across the entire
  // history is 1. complicated and 2. unnecessary as this function is only needed for affiliate calculations.
  public getHistoricalPricePeriods(): [number, BN][] {
    if (!this.convertToPriceFeedDecimals) throw new Error(`${this.uuid} -- Haven't called update() yet.`);
    return this.events.map((event) => {
      return [event.timestamp, this.convertToPriceFeedDecimals!(event.price)];
    });
  }

  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }

  public getLookback(): number {
    return this.historicalLookback;
  }

  // Not part of the price feed interface. Can be used to pull the uniswap price at the most recent block.
  public getLastBlockPrice(): null | BN {
    return (
      this.lastBlockPrice && this.convertToPriceFeedDecimals && this.convertToPriceFeedDecimals(this.lastBlockPrice)
    );
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }

  public async update(): Promise<void> {
    // Read token0 and token1 precision from Uniswap contract if not already cached:
    if (!this.token0Precision || !this.token1Precision || !this.convertToPriceFeedDecimals) {
      const [token0Address, token1Address] = await Promise.all([
        this.uniswap.methods.token0().call(),
        this.uniswap.methods.token1().call(),
      ]);
      this.token0 = (new this.web3.eth.Contract(this.erc20Abi, token0Address) as unknown) as ERC20Web3;
      this.token1 = (new this.web3.eth.Contract(this.erc20Abi, token1Address) as unknown) as ERC20Web3;
      const [token0Precision, token1Precision] = await Promise.all([
        this.token0.methods.decimals().call(),
        this.token1.methods.decimals().call(),
      ]);
      this.token0Precision = parseInt(token0Precision);
      this.token1Precision = parseInt(token1Precision);
      // `_getPriceFromSyncEvent()` returns prices in the same precision as `token1` unless price is inverted.
      // Therefore, `convertToPriceFeedDecimals` will convert from `token1Precision` to the user's desired
      // `priceFeedDecimals`, unless inverted then it will convert from `token0Precision` to `priceFeedDecimals`.
      this.convertToPriceFeedDecimals = ConvertDecimals(
        Number(this.invertPrice ? this.token0Precision : this.token1Precision),
        this.priceFeedDecimals
      );
    }

    // Approximate the first block from which we'll need price data from based on the lookback and twap length:
    const lookbackWindow = this.twapLength + this.historicalLookback;
    const currentTime = await this.getTime();
    const earliestLookbackTime = currentTime - lookbackWindow;
    const latestBlockNumber = (await this.web3.eth.getBlock("latest")).number;
    // Add cushion in case `averageBlockTimeSeconds` underestimates the seconds per block:
    const lookbackBlocks = Math.ceil((this.bufferBlockPercent * lookbackWindow) / (await averageBlockTimeSeconds()));

    let events: (EventData & { timestamp: number; price: BN | null })[] = []; // Caches sorted events (to keep subsequent event queries as small as possible).
    let fromBlock = Infinity; // Arbitrary initial value > 0.

    // For loop continues until the start block hits 0 or the first event is before the earliest lookback time.
    for (let i = 0; !(fromBlock === 0 || events[0]?.timestamp <= earliestLookbackTime); i++) {
      // Uses latest unless the events array already has data. If so, it only queries _before_ existing events.
      const toBlock = events[0] ? events[0].blockNumber - 1 : "latest";

      // By taking larger powers of 2, this doubles the lookback each time.
      fromBlock = Math.max(0, latestBlockNumber - lookbackBlocks * 2 ** i);

      const newEvents = await this._getSortedEvents(fromBlock, toBlock).then((newEvents) => {
        // Grabs the timestamps for all blocks, but avoids re-querying by .then-ing any cached blocks.
        return Promise.all(
          newEvents.map((event) => {
            // If there is nothing in the cache for this block number, add a new promise that will resolve to the block.
            if (!this.blocks[event.blockNumber]) {
              this.blocks[event.blockNumber] = this.web3.eth
                .getBlock(event.blockNumber)
                .then((block) => ({ timestamp: Number(block.timestamp), number: block.number }));
            }

            // Add a .then to the promise that sets the timestamp (and price) for this event after the promise resolves.
            return this.blocks[event.blockNumber].then((block) => {
              return { ...event, timestamp: block.timestamp, price: this._getPriceFromEvent(event) };
            });
          })
        );
      });

      // Adds newly queried events to the array.
      events = [...newEvents, ...events];
    }

    // If there are still no prices, return null to allow the user to handle the absence of data.
    if (events.length === 0) {
      this.currentTwap = null;
      this.lastBlockPrice = null;
      this.events = [];
      return;
    }

    // Filter out events where price is null.
    const isPriceDefined = <T extends { price: BN | null }>(event: T): event is T & { price: BN } =>
      event.price !== null;
    this.events = events.filter(isPriceDefined);

    // Price at the end of the most recent block.
    this.lastBlockPrice = this.events[this.events.length - 1].price;

    // Compute TWAP up to the current time.
    this.currentTwap = this._computeTwap(this.events, currentTime - this.twapLength, currentTime);

    this.lastUpdateTime = currentTime;
  }

  _computeTwap(eventsIn: UniswapEventWithPrice[], startTime: number, endTime: number): BN | null {
    const events = eventsIn.map((e) => {
      return [e.timestamp, e.price] as [number, BN];
    });
    return computeTWAP(events, startTime, endTime, toBN("0"));
  }

  protected abstract _getSortedEvents(fromBlock: number, toBlock: number | "latest"): Promise<EventData[]>;

  protected abstract _getPriceFromEvent(event: EventData): BN | null;
}

export class UniswapV2PriceFeed extends UniswapPriceFeed {
  protected async _getSortedEvents(fromBlock: number, toBlock: number | "latest"): Promise<EventData[]> {
    const events = await this.uniswap.getPastEvents("Sync", { fromBlock, toBlock });
    // Primary sort on block number. Secondary sort on transactionIndex. Tertiary sort on logIndex.
    events.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }

      if (a.transactionIndex !== b.transactionIndex) {
        return a.transactionIndex - b.transactionIndex;
      }

      return a.logIndex - b.logIndex;
    });

    return events;
  }

  protected _getPriceFromEvent(event: EventData): BN | null {
    if (this.token1Precision === null || this.token0Precision === null)
      throw new Error(`${this.uuid} -- update was not called`);
    // Fixed point adjustment should use same precision as token0, unless price is inverted.
    const fixedPointAdjustment = toBN(
      parseFixed("1", this.invertPrice ? this.token1Precision : this.token0Precision).toString()
    );

    const reserve0 = toBN(event.returnValues.reserve0);
    const reserve1 = toBN(event.returnValues.reserve1);

    if (reserve1.isZero() || reserve0.isZero()) return null;

    // Price is returned using same precision as base currency, which is token1 unless inverted.
    if (this.invertPrice) {
      return reserve0.mul(fixedPointAdjustment).div(reserve1);
    } else {
      return reserve1.mul(fixedPointAdjustment).div(reserve0);
    }
  }
}

export class UniswapV3PriceFeed extends UniswapPriceFeed {
  protected async _getSortedEvents(fromBlock: number, toBlock: number | "latest"): Promise<EventData[]> {
    const events = await this.uniswap.getPastEvents("Swap", { fromBlock: fromBlock, toBlock: toBlock });
    // Primary sort on block number. Secondary sort on transactionIndex. Tertiary sort on logIndex.
    events.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }

      if (a.transactionIndex !== b.transactionIndex) {
        return a.transactionIndex - b.transactionIndex;
      }

      return a.logIndex - b.logIndex;
    });

    return events;
  }

  protected _getPriceFromEvent(event: EventData): BN {
    if (this.token1Precision === null || this.token0Precision === null)
      throw new Error(`${this.uuid} -- update was not called`);
    // Fixed point adjustment should use same precision as token0, unless price is inverted.
    const fixedPointAdjustment = toBN(
      parseFixed("1", this.invertPrice ? this.token1Precision : this.token0Precision).toString()
    );

    const X96Adjustment = toBN(2).pow(toBN(96));
    const rawSqrtPrice = toBN(event.returnValues.sqrtPriceX96);
    // This effectively computes the price by squaring the value, multiplying it up by our intended precision, then dividing out both X96 fixed point multipliers.
    const nonInvertedPrice = rawSqrtPrice
      .mul(rawSqrtPrice)
      .mul(fixedPointAdjustment)
      .div(X96Adjustment)
      .div(X96Adjustment);

    return this.invertPrice ? fixedPointAdjustment.mul(fixedPointAdjustment).div(nonInvertedPrice) : nonInvertedPrice;
  }
}
