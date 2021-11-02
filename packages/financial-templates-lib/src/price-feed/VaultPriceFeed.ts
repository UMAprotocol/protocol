import { PriceFeedInterface } from "./PriceFeedInterface";
import { BlockFinder } from "./utils";
import { ConvertDecimals } from "@uma/common";
import assert from "assert";
import type { Logger } from "winston";
import Web3 from "web3";
import { VaultInterfaceWeb3, HarvestVaultInterfaceWeb3 } from "@uma/contracts-frontend";
import { BN, Abi } from "../types";
import { BlockTransactionBase } from "web3-eth";

interface Params {
  logger: Logger;
  vaultAbi: Abi;
  erc20Abi: Abi;
  web3: Web3;
  vaultAddress: string;
  getTime: () => Promise<number>;
  blockFinder: BlockFinder<BlockTransactionBase>;
  minTimeBetweenUpdates?: number;
  priceFeedDecimals?: number;
}

export abstract class VaultPriceFeedBase extends PriceFeedInterface {
  private readonly logger: Logger;
  private readonly web3: Web3;
  protected readonly vault: VaultInterfaceWeb3 | HarvestVaultInterfaceWeb3;
  private readonly erc20Abi: Abi;
  private readonly uuid: string;
  private readonly getTime: () => Promise<number>;
  private readonly priceFeedDecimals: number;
  private readonly minTimeBetweenUpdates: number;
  private readonly blockFinder: BlockFinder<BlockTransactionBase>;
  private cachedConvertDecimalsFn: ReturnType<typeof ConvertDecimals> | null = null;
  private price: BN | null = null;
  private lastUpdateTime: number | null = null;

  /**
   * @notice Constructs new price feed object that tracks the share price of a yearn-style vault.
   * @dev Note: this only supports badger Setts and Yearn v1 right now.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} vaultAbi Yearn Vault abi object to create a contract instance.
   * @param {Object} erc20Abi ERC20 abi object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} vaultAddress Ethereum address of the yearn-style vault to monitor.
   * @param {Function} getTime Returns the current time.
   * @param {Function} [blockFinder] Optionally pass in a shared blockFinder instance (to share the cache).
   * @param {Integer} [minTimeBetweenUpdates] Minimum amount of time that must pass before update will actually run
   *                                        again.
   * @param {Integer} [priceFeedDecimals] Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor({
    logger,
    vaultAbi,
    erc20Abi,
    web3,
    vaultAddress,
    getTime,
    blockFinder,
    minTimeBetweenUpdates = 60,
    priceFeedDecimals = 18,
  }: Params) {
    super();

    // Assert required inputs.
    assert(logger, "logger required");
    assert(vaultAbi, "vaultAbi required");
    assert(erc20Abi, "erc20Abi required");
    assert(web3, "web3 required");
    assert(vaultAddress, "vaultAddress required");
    assert(getTime, "getTime required");

    this.web3 = web3;
    this.logger = logger;
    this.vault = (new web3.eth.Contract(vaultAbi, vaultAddress) as unknown) as
      | VaultInterfaceWeb3
      | HarvestVaultInterfaceWeb3;
    this.erc20Abi = erc20Abi;
    this.uuid = `Vault-${vaultAddress}`;
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
    if (!block) throw new Error(`${this.uuid} -- block not found`);
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

  private async _getPrice(blockNumber: number | "latest" = "latest") {
    const rawPrice = await this.vault.methods.getPricePerFullShare().call(undefined, blockNumber);
    return await this._convertDecimals(rawPrice);
  }

  private async _convertDecimals(value: BN | string | number) {
    if (!this.cachedConvertDecimalsFn) {
      const underlyingTokenAddress = await this._tokenTransaction().call();
      const underlyingToken = new this.web3.eth.Contract(this.erc20Abi, underlyingTokenAddress);

      let underlyingTokenDecimals;
      try {
        underlyingTokenDecimals = await underlyingToken.methods.decimals().call();
      } catch (err) {
        underlyingTokenDecimals = 18;
      }

      this.cachedConvertDecimalsFn = ConvertDecimals(parseInt(underlyingTokenDecimals), this.priceFeedDecimals);
    }
    return this.cachedConvertDecimalsFn(value);
  }

  protected abstract _tokenTransaction(): { call: () => Promise<string> };
}

// Note: we may rename this in the future to YearnV1Vault or something, but just for simplicity, we can keep the name the same for now.
export class VaultPriceFeed extends VaultPriceFeedBase {
  protected _tokenTransaction(): { call: () => Promise<string> } {
    const vault = this.vault as VaultInterfaceWeb3;
    return vault.methods.token();
  }
}

export class HarvestVaultPriceFeed extends VaultPriceFeedBase {
  protected _tokenTransaction(): { call: () => Promise<string> } {
    const vault = this.vault as HarvestVaultInterfaceWeb3;
    return vault.methods.underlying();
  }
}
