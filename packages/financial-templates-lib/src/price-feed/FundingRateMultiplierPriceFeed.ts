import { PriceFeedInterface } from "./PriceFeedInterface";
import { BlockFinder } from "./utils";
import { ConvertDecimals } from "@uma/common";
import { aggregateTransactionsAndCall } from "../helpers/multicall";
import assert from "assert";
import type { Logger } from "winston";
import Web3 from "web3";
import { PerpetualWeb3 } from "@uma/contracts-frontend";
import { BN, Abi, Awaited } from "../types";
import type { BlockTransactionBase } from "web3-eth";

interface Params {
  logger: Logger;
  perpetualAbi: Abi;
  web3: Web3;
  perpetualAddress: string;
  multicallAddress: string;
  getTime: () => Promise<number>;
  blockFinder?: BlockFinder<BlockTransactionBase>;
  minTimeBetweenUpdates?: number;
  priceFeedDecimals?: number;
}

export class FundingRateMultiplierPriceFeed extends PriceFeedInterface {
  private readonly logger: Logger;
  private readonly web3: Web3;
  private readonly getTime: () => Promise<number>;
  private readonly multicallAddress: string;
  private readonly blockFinder: BlockFinder<BlockTransactionBase>;
  private readonly minTimeBetweenUpdates: number;
  private readonly priceFeedDecimals: number;
  private lastUpdateTime: number | null = null;
  private readonly uuid: string;
  private price: BN | null = null;
  private readonly convertDecimals: ReturnType<typeof ConvertDecimals>;
  public readonly perpetual: PerpetualWeb3;

  /**
   * @notice Constructs new price feed object that tracks the funding rate multiplier in a particular perpetual contract.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} perpetualAbi Perpetual abi object to create a contract instance.
   * @param {Object} web3 Provider to connect to Ethereum network.
   * @param {String} perpetualAddress Ethereum address of the perpetual to monitor.
   * @param {String} multicallAddress Ethereum address of the multicall contract.
   * @param {Function} getTime Returns the current time.
   * @param {Function} [blockFinder] Optionally pass in a shared blockFinder instance (to share the cache).
   * @param {Integer} [minTimeBetweenUpdates] Minimum time that must pass before update will actually run again.
   * @param {Integer} [priceFeedDecimals] Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor({
    logger,
    perpetualAbi,
    web3,
    perpetualAddress,
    multicallAddress,
    getTime,
    blockFinder,
    minTimeBetweenUpdates = 60,
    priceFeedDecimals = 18,
  }: Params) {
    super();

    // Assert required inputs.
    assert(logger, "logger required");
    assert(perpetualAbi, "perpetualAbi required");
    assert(web3, "web3 required");
    assert(web3.utils.isAddress(multicallAddress), "multicallAddress required");
    assert(web3.utils.isAddress(perpetualAddress), "perpetualAddress required");
    assert(getTime, "getTime required");

    this.logger = logger;
    this.web3 = web3;

    this.perpetual = (new web3.eth.Contract(perpetualAbi, perpetualAddress) as unknown) as PerpetualWeb3;
    this.multicallAddress = multicallAddress;
    this.uuid = `FundingRateMultiplier-${perpetualAddress}`;
    this.getTime = getTime;
    this.priceFeedDecimals = priceFeedDecimals;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    // Must wrap the getBlock in a lambda to specify the overload.
    this.blockFinder = blockFinder || new BlockFinder<BlockTransactionBase>(web3.eth.getBlock);
    this.convertDecimals = ConvertDecimals(18, priceFeedDecimals);
  }

  public getCurrentPrice(): BN | null {
    return this.price;
  }

  public async getHistoricalPrice(time: number): Promise<BN> {
    const block = await this.blockFinder.getBlockForTimestamp(time);
    return this._getPrice(block.number);
  }

  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }

  public getLookback(): number {
    // Return infinity since this price feed can technically look back as far as needed.
    return Infinity;
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }

  public async update(): Promise<void> {
    const currentTime = await this.getTime();
    if (this.lastUpdateTime === null || currentTime >= this.lastUpdateTime + this.minTimeBetweenUpdates) {
      this.price = await this._getPrice();
      this.lastUpdateTime = currentTime;
    }
  }

  private async _getPrice(blockNumber: number | string = "latest"): Promise<BN> {
    const applyFundingRateData = this.perpetual.methods.applyFundingRate().encodeABI();
    const getFundingRateData = this.perpetual.methods.fundingRate().encodeABI();
    const target = this.perpetual.options.address;
    const transactions = [
      { target, callData: applyFundingRateData },
      { target, callData: getFundingRateData },
    ];

    type ApplyFundingRateReturnValue = Awaited<
      ReturnType<ReturnType<PerpetualWeb3["methods"]["applyFundingRate"]>["call"]>
    >;
    type FundingRateReturnValue = Awaited<ReturnType<ReturnType<PerpetualWeb3["methods"]["fundingRate"]>["call"]>>;

    const [, { cumulativeMultiplier }] = (await aggregateTransactionsAndCall(
      this.multicallAddress,
      this.web3,
      transactions,
      Number(blockNumber)
    )) as [ApplyFundingRateReturnValue, FundingRateReturnValue];
    return this.convertDecimals(cumulativeMultiplier[0]);
  }
}
