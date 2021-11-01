import { PriceFeedInterface } from "./PriceFeedInterface";
import { BlockFinder } from "./utils";
import { ConvertDecimals } from "@uma/common";
import assert from "assert";
import type { Logger } from "winston";
import type { Abi } from "../types";
import Web3 from "web3";
import type { BlockTransactionBase } from "web3-eth";
import type { ERC20Web3 } from "@uma/contracts-node";
import type { BN } from "../types";

interface Params {
  logger: Logger;
  web3: Web3;
  erc20Abi: Abi;
  poolAddress: string;
  tokenAddress: string;
  getTime: () => Promise<number>;
  blockFinder?: BlockFinder<BlockTransactionBase>;
  minTimeBetweenUpdates?: number;
  priceFeedDecimals?: number;
}

export class LPPriceFeed extends PriceFeedInterface {
  private readonly logger: Logger;
  private readonly web3: Web3;
  private readonly toBN = Web3.utils.toBN;
  private readonly pool: ERC20Web3;
  private readonly token: ERC20Web3;
  private readonly uuid: string;
  private readonly getTime: () => Promise<number>;
  private readonly priceFeedDecimals: number;
  private readonly minTimeBetweenUpdates: number;
  private readonly blockFinder: BlockFinder<BlockTransactionBase>;

  private price: BN | null = null;
  private lastUpdateTime: number | null = null;
  private tokenDecimals: number | null = null;
  private poolDecimals: number | null = null;

  /**
   * @notice Constructs new price feed object that tracks how much of a provided token a single LP share is redeemable
   *         for.
   * @dev Note: this can support most LP shares and may support other types of pool contracts.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {Object} erc20Abi ERC20 abi object to create a contract instance.
   * @param {String} poolAddress Ethereum address of the LP pool to monitor.
   * @param {String} tokenAddress Ethereum address of the per-share token balance we're tracking within the pool.
   * @param {Function} getTime Returns the current time.
   * @param {Function} [blockFinder] Optionally pass in a shared blockFinder instance (to share the cache).
   * @param {Integer} [minTimeBetweenUpdates] Minimum amount of time that must pass before update will actually run
   *                                        again.
   * @param {Integer} [priceFeedDecimals] Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor({
    logger,
    web3,
    erc20Abi,
    poolAddress,
    tokenAddress,
    getTime,
    blockFinder,
    minTimeBetweenUpdates = 60,
    priceFeedDecimals = 18,
  }: Params) {
    super();

    // Assert required arguments.
    assert(logger, "logger required");
    assert(web3, "web3 required");
    assert(erc20Abi, "erc20Abi required");
    assert(poolAddress, "poolAddress required");
    assert(tokenAddress, "tokenAddress required");
    assert(getTime, "getTime required");

    this.logger = logger;
    this.web3 = web3;

    this.pool = (new web3.eth.Contract(erc20Abi, poolAddress) as unknown) as ERC20Web3;
    this.token = (new web3.eth.Contract(erc20Abi, tokenAddress) as unknown) as ERC20Web3;
    this.uuid = `LP-${poolAddress}-${tokenAddress}`;
    this.getTime = getTime;
    this.priceFeedDecimals = priceFeedDecimals;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.blockFinder = blockFinder || new BlockFinder<BlockTransactionBase>(web3.eth.getBlock);
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

  private async _getDecimals(): Promise<{ poolDecimals: number; tokenDecimals: number }> {
    if (this.tokenDecimals === null) {
      this.tokenDecimals = parseInt(await this.token.methods.decimals().call());
    }

    if (this.poolDecimals === null) {
      this.poolDecimals = parseInt(await this.pool.methods.decimals().call());
    }

    return { poolDecimals: this.poolDecimals, tokenDecimals: this.tokenDecimals };
  }

  private async _getPrice(blockNumber: number | "latest" = "latest"): Promise<BN> {
    const lpTotalSupply = this.toBN(await this.pool.methods.totalSupply().call(undefined, blockNumber));
    const tokensInPool = this.toBN(
      await this.token.methods.balanceOf(this.pool.options.address).call(undefined, blockNumber)
    );

    // 10^decimals is the fixed point multiplier for the pool.
    const { poolDecimals } = await this._getDecimals();
    const poolDecimalMultiplier = this.toBN("10").pow(this.toBN(poolDecimals));

    // To get the price, we divide the total tokens in the pool by the number of LP shares.
    // Note: this produces a rawPrice that is in terms of the token's decimals, not the pool's.
    // Note: if the total supply is zero, then we just set the price to 0 since no LP tokens exist.
    const rawPrice = lpTotalSupply.isZero()
      ? this.web3.utils.toBN("0")
      : tokensInPool.mul(poolDecimalMultiplier).divRound(lpTotalSupply);

    // _convertDecimals takes a price with the token's decimals and returns it in terms of priceFeedDecimals.
    return await this._convertDecimals(rawPrice);
  }

  // Converts decimals from the token decimals to the configured output decimals.
  private async _convertDecimals(value: BN): Promise<BN> {
    const { tokenDecimals } = await this._getDecimals();
    const convertDecimals = ConvertDecimals(tokenDecimals, this.priceFeedDecimals);
    return convertDecimals(value);
  }
}
