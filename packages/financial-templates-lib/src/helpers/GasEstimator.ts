import fetch from "node-fetch";
import Web3 from "web3";

import type { Logger } from "winston";

enum NetworkType {
  Legacy,
  London,
}

type LondonGasData = { maxFeePerGas: number; maxPriorityFeePerGas: number };
type LegacyGasData = { gasPrice: number };

interface GasEstimatorMapping {
  [networkId: number]: {
    url: string;
    defaultFastPriceGwei?: number;
    defaultMaxFeePerGasGwei?: number;
    defaultMaxPriorityFeePerGasGwei?: number;
    type: NetworkType;
    backupUrl?: string;
  };
}

interface EtherchainResponse {
  safeLow: number;
  standard: number;
  fast: number;
  fastest: number;
  currentBaseFee: number;
  recommendedBaseFee: number;
}

interface MaticResponse {
  safeLow: number;
  standard: number;
  fast: number;
  fastest: number;
  blockTime: number;
  blockNumber: number;
}

export const MAPPING_BY_NETWORK: GasEstimatorMapping = {
  // Expected shape:
  // <netId>: {
  //     url: <primary-gas-station-url>,
  //     backupUrl: <optional-backup-gas-station-url>,
  //     defaultFastPricesGwei: <default-gas-price-for-network>
  // }
  1: {
    url: "https://www.etherchain.org/api/gasPriceOracle",
    defaultMaxFeePerGasGwei: 500,
    defaultMaxPriorityFeePerGasGwei: 5,
    type: NetworkType.London,
  },
  137: { url: "https://gasstation-mainnet.matic.network", defaultFastPriceGwei: 10, type: NetworkType.Legacy },
  80001: { url: "https://gasstation-mumbai.matic.today", defaultFastPriceGwei: 20, type: NetworkType.Legacy },
};

const DEFAULT_NETWORK_ID = 1; // Ethereum Mainnet.
export class GasEstimator {
  private lastUpdateTimestamp: undefined | number;
  private lastFastPriceGwei = 0;
  private latestMaxFeePerGasGwei: number;
  private latestMaxPriorityFeePerGasGwei: number;
  private latestBaseFee: number;

  private defaultFastPriceGwei = 0;
  private defaultMaxFeePerGasGwei = 0;
  private defaultMaxPriorityFeePerGasGwei = 0;

  private type: NetworkType;

  /**
   * @notice Constructs new GasEstimator.
   * @param {Object} logger Winston module used to send logs.
   * @param {Integer} updateThreshold How long, in seconds, the estimator should wait between updates.
   * @param {Integer} networkId Network ID to lookup gas for. Default value is 1 corresponding to Ethereum.
   * @return None or throws an Error.
   */

  constructor(
    private readonly logger: Logger,
    private readonly updateThreshold = 60,
    private readonly networkId = DEFAULT_NETWORK_ID,
    private readonly web3: Web3 | undefined = undefined
  ) {
    // If networkId is not found in MAPPING_BY_NETWORK, then default to 1.
    if (!Object.keys(MAPPING_BY_NETWORK).includes(networkId.toString())) this.networkId = DEFAULT_NETWORK_ID;
    else this.networkId = networkId;

    // If the script fails or the API response fails default to these value. If the network ID provided is not in the
    // mapping, then use the default ID.
    if (!Object.keys(MAPPING_BY_NETWORK).includes(networkId.toString())) this.networkId = DEFAULT_NETWORK_ID;

    this.defaultFastPriceGwei = MAPPING_BY_NETWORK[this.networkId].defaultFastPriceGwei || 0;
    this.defaultMaxFeePerGasGwei = MAPPING_BY_NETWORK[this.networkId].defaultMaxFeePerGasGwei || 0;
    this.defaultMaxPriorityFeePerGasGwei = MAPPING_BY_NETWORK[this.networkId].defaultMaxPriorityFeePerGasGwei || 0;
    this.type = MAPPING_BY_NETWORK[this.networkId].type;

    // Set the initial values to the defaults.
    this.lastFastPriceGwei = this.defaultFastPriceGwei;
    this.latestMaxFeePerGasGwei = this.defaultMaxFeePerGasGwei;
    this.latestBaseFee = this.defaultMaxFeePerGasGwei;
    this.latestMaxPriorityFeePerGasGwei = this.defaultMaxPriorityFeePerGasGwei;
  }

  // Calls update unless it was recently called, as determined by this.updateThreshold.
  async update(): Promise<void> {
    const currentTime = Math.floor(Date.now() / 1000);
    if (this.lastUpdateTimestamp !== undefined && currentTime < this.lastUpdateTimestamp + this.updateThreshold) {
      this.logger.debug({
        at: "GasEstimator",
        networkType: this.type == NetworkType.Legacy ? "Legacy" : "London",
        message: "Gas estimator update skipped",
        networkId: this.networkId,
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        currentMaxFeePerGas: this.latestMaxFeePerGasGwei,
        currentMaxPriorityFeePerGas: this.latestMaxPriorityFeePerGasGwei,
        lastFastPriceGwei: this.lastFastPriceGwei,
        lastBaseFee: this.latestBaseFee,
        timeRemainingUntilUpdate: this.lastUpdateTimestamp + this.updateThreshold - currentTime,
      });
      return;
    } else {
      await this._update();
      this.lastUpdateTimestamp = currentTime;
      this.logger.debug({
        at: "GasEstimator",
        networkType: this.type == NetworkType.Legacy ? "Legacy" : "London",
        message: "Gas estimator updated",
        networkId: this.networkId,
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        currentMaxFeePerGas: this.latestMaxFeePerGasGwei,
        currentMaxPriorityFeePerGas: this.latestMaxPriorityFeePerGasGwei,
        lastFastPriceGwei: this.lastFastPriceGwei,
        latestBaseFee: this.latestBaseFee,
      });
    }
  }

  // Returns the current fast maxFeePerGas and maxPriorityFeePerGas OR gasPrice in gwei depending on the connected network.
  getCurrentFastPrice(): LondonGasData | LegacyGasData {
    // Sometimes the multiplication by 1e9 introduces some error into the resulting number, so we'll conservatively ceil
    // the result before returning. This output is usually passed into a web3 contract call so it MUST be an integer.
    if (this.type == NetworkType.London)
      return {
        maxFeePerGas: Math.ceil(this.latestMaxFeePerGasGwei * 1e9),
        maxPriorityFeePerGas: Math.ceil(this.latestMaxPriorityFeePerGasGwei * 1e9),
      };
    else return { gasPrice: Math.ceil(this.lastFastPriceGwei * 1e9) };
  }

  // Returns an estimate of the gas price that you will actually pay based on most recent data. If this is a london
  // network then you will pay the prevailing base fee + the max priority fee. if not london then pay the latest fast
  // gas price.
  getExpectedCumulativeGasPrice(): number {
    if (this.type == NetworkType.London) return this.latestBaseFee + this.latestMaxPriorityFeePerGasGwei;
    else return this.lastFastPriceGwei;
  }

  async _update() {
    // Fetch the latest gas info from the gas price API and fetch the latest block to extract baseFeePerGas, if London.
    const [gasInfo, latestBlock] = await Promise.all([
      this._getPrice(this.networkId),
      this.web3 && this.type == NetworkType.London ? this.web3.eth.getBlock("latest") : null,
    ]);

    if (this.type == NetworkType.London) {
      this.latestMaxFeePerGasGwei = (gasInfo as LondonGasData).maxFeePerGas;
      this.latestMaxPriorityFeePerGasGwei = (gasInfo as LondonGasData).maxPriorityFeePerGas;
      // Extract the base fee from the most recent block. If the block is not available or errored then is set to 0.
      this.latestBaseFee = Number((latestBlock as any)?.baseFeePerGas) || 0;
    } else this.lastFastPriceGwei = (gasInfo as LegacyGasData).gasPrice;
  }

  async _getPrice(_networkId: number): Promise<LondonGasData | LegacyGasData> {
    const url = MAPPING_BY_NETWORK[_networkId].url;
    const backupUrl = MAPPING_BY_NETWORK[_networkId].backupUrl;

    if (!url) throw new Error(`Missing URL for network ID ${_networkId}`);

    try {
      // Primary URL expected response structure for London.
      // {
      //    safeLow: 1, // slow maxPriorityFeePerGas
      //    standard: 1.5, // standard maxPriorityFeePerGas
      //    fast: 4, // fast maxPriorityFeePerGas
      //    fastest: 6.2, // fastest maxPriorityFeePerGas
      //    currentBaseFee: 33.1, // previous blocks base fee
      //    recommendedBaseFee: 67.1 // maxFeePerGas
      // }
      // Primary URL expected response structure for legacy.
      // {
      //    "safeLow": 3,
      //    "standard": 15,
      //    "fast": 40,
      //    "fastest": 311,
      //    "blockTime": 2,
      //    "blockNumber": 18040517
      // }
      const response = await fetch(url);
      const json = await response.json();
      return this._extractFastGasPrice(json, url);
    } catch (error) {
      this.logger.debug({
        at: "GasEstimator",
        networkType: this.type == NetworkType.Legacy ? "Legacy" : "London",
        message: "client polling error, trying backup API🚨",
        error: typeof error === "string" ? new Error(error) : error,
      });

      // Try backup API.
      if (backupUrl) {
        try {
          const responseBackup = await fetch(backupUrl);
          const jsonBackup = await responseBackup.json();
          return this._extractFastGasPrice(jsonBackup, backupUrl);
        } catch (errorBackup) {
          this.logger.debug({
            at: "GasEstimator",
            networkType: this.type == NetworkType.Legacy ? "Legacy" : "London",
            message: "backup API failed, falling back to default fast gas price🚨",
            defaultMaxFeePerGasGwei: this.defaultMaxFeePerGasGwei,
            error: typeof errorBackup === "string" ? new Error(errorBackup) : errorBackup,
          });
        }
      }

      // In the failure mode return the fast default price.
      return { maxFeePerGas: this.defaultMaxFeePerGasGwei, maxPriorityFeePerGas: this.defaultMaxPriorityFeePerGasGwei };
    }
  }

  private _extractFastGasPrice(json: { [key: string]: any }, url: string): LondonGasData | LegacyGasData {
    if (url.includes("etherchain.org")) {
      const etherchainResponse = json as EtherchainResponse;
      if (etherchainResponse.recommendedBaseFee === undefined) throw new Error(`Bad etherchain response ${json}`);
      return {
        maxFeePerGas: etherchainResponse.recommendedBaseFee,
        maxPriorityFeePerGas: etherchainResponse.fastest,
      } as LondonGasData;
    } else if (url.includes("matic")) {
      const maticResponse = json as MaticResponse;
      if (maticResponse.fastest === undefined) throw new Error(`Bad matic response ${json}`);
      return { gasPrice: maticResponse.fastest } as LegacyGasData;
    } else {
      throw new Error("Unknown api");
    }
  }
}
