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
    type: NetworkType;
    url?: string;
    defaultFastPriceGwei?: number;
    defaultMaxFeePerGasGwei?: number;
    defaultMaxPriorityFeePerGasGwei?: number;
    backupUrl?: string;
  };
}
interface EtherscanGasResponse {
  status: string;
  message: string;
  result: {
    LastBlock: string;
    SafeGasPrice: string;
    ProposeGasPrice: string;
    FastGasPrice: string;
    suggestBaseFee: string;
    gasUsedRatio: string;
  };
}

interface MaticGasPriceData {
  maxPriorityFee: number | string;
  maxFee: number | string;
}
interface MumbaiResponseGasStation {
  safeLow: MaticGasPriceData;
  standard: MaticGasPriceData;
  fast: MaticGasPriceData;
  estimatedBaseFee: string;
  blockTime: number;
  blockNumber: number;
}

export const MAPPING_BY_NETWORK: GasEstimatorMapping = {
  1: {
    url: "https://api.etherscan.io/api?module=gastracker&action=gasoracle",
    defaultMaxFeePerGasGwei: 500,
    defaultMaxPriorityFeePerGasGwei: 1,
    type: NetworkType.London,
  },
  10: { defaultFastPriceGwei: 1, type: NetworkType.Legacy },
  137: {
    url: "https://api.polygonscan.com/api?module=gastracker&action=gasoracle",
    defaultMaxFeePerGasGwei: 500,
    defaultMaxPriorityFeePerGasGwei: 100,
    type: NetworkType.London,
  },
  288: { defaultFastPriceGwei: 1, type: NetworkType.Legacy },
  1115: { defaultFastPriceGwei: 30, type: NetworkType.Legacy },
  1116: { defaultFastPriceGwei: 30, type: NetworkType.Legacy },
  8453: { defaultFastPriceGwei: 1, type: NetworkType.Legacy },
  42161: { defaultFastPriceGwei: 10, type: NetworkType.Legacy },
  80001: {
    url: "https://gasstation-testnet.polygon.technology/v2",
    defaultMaxFeePerGasGwei: 50, // maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas
    defaultMaxPriorityFeePerGasGwei: 1,
    type: NetworkType.London,
  },
  81457: { defaultFastPriceGwei: 1, type: NetworkType.Legacy },
};

const DEFAULT_NETWORK_ID = 1; // Ethereum Mainnet.
export class GasEstimator {
  private lastUpdateTimestamp: undefined | number;
  private lastFastPriceGwei = 0;
  private latestMaxFeePerGasGwei: number;
  private latestMaxPriorityFeePerGasGwei: number;
  private latestBaseFeeGwei: number;

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
    if (!Object.keys(MAPPING_BY_NETWORK).includes(networkId.toString())) {
      logger.debug({
        at: "GasEstimator",
        message: "Unrecognized network ID, defaulting to default",
        defaultNetworkId: DEFAULT_NETWORK_ID,
        unrecognizedNetworkId: networkId.toString(),
        defaultNetworkMapping: MAPPING_BY_NETWORK[DEFAULT_NETWORK_ID],
      });
      this.networkId = DEFAULT_NETWORK_ID;
    }

    this.defaultFastPriceGwei = MAPPING_BY_NETWORK[this.networkId].defaultFastPriceGwei || 0;
    this.defaultMaxFeePerGasGwei = MAPPING_BY_NETWORK[this.networkId].defaultMaxFeePerGasGwei || 0;
    this.defaultMaxPriorityFeePerGasGwei = MAPPING_BY_NETWORK[this.networkId].defaultMaxPriorityFeePerGasGwei || 0;
    this.type = MAPPING_BY_NETWORK[this.networkId].type;

    // Set the initial values to the defaults.
    this.lastFastPriceGwei = this.defaultFastPriceGwei;
    this.latestMaxFeePerGasGwei = this.defaultMaxFeePerGasGwei;
    this.latestBaseFeeGwei = this.defaultMaxFeePerGasGwei;
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
        lastBaseFee: this.latestBaseFeeGwei,
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
        latestBaseFeeGwei: this.latestBaseFeeGwei,
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
    if (this.type == NetworkType.London)
      return this.latestBaseFeeGwei * 1e9 + this.latestMaxPriorityFeePerGasGwei * 1e9;
    else return this.lastFastPriceGwei * 1e9;
  }

  async _update(): Promise<void> {
    // Fetch the latest gas info from the gas price API and fetch the latest block to extract baseFeePerGas, if London.
    const [gasInfo, latestBlock] = await Promise.all([
      this._getPrice(this.networkId),
      this.web3 && this.type == NetworkType.London ? this.web3.eth.getBlock("latest") : null,
    ]);

    if (this.type == NetworkType.London) {
      this.latestMaxPriorityFeePerGasGwei = (gasInfo as LondonGasData).maxPriorityFeePerGas;
      // If we are using a hardcoded maxPriorityFeePerGas value, ensure that maxFeePerGas is not set below it.
      this.latestMaxFeePerGasGwei = Math.max(
        (gasInfo as LondonGasData).maxFeePerGas,
        this.latestMaxPriorityFeePerGasGwei
      );

      // Extract the base fee from the most recent block. If the block is not available or errored then is set to the
      // latest max fee per gas so we still have some value in the right ballpark to return to the client implementer.
      // Base fee is represented in Wei so we convert to Gwei to be consistent with other variables in this class.
      this.latestBaseFeeGwei = Number((latestBlock as any)?.baseFeePerGas) / 1e9 || this.latestMaxFeePerGasGwei;
    } else this.lastFastPriceGwei = (gasInfo as LegacyGasData).gasPrice;
  }

  async _getPrice(_networkId: number): Promise<LondonGasData | LegacyGasData> {
    const url = MAPPING_BY_NETWORK[_networkId].url;
    const backupUrl = MAPPING_BY_NETWORK[_networkId].backupUrl;

    if (!url) {
      // If no URL specified, use default.
      return {
        gasPrice: this.defaultFastPriceGwei,
        maxFeePerGas: this.defaultMaxFeePerGasGwei,
        maxPriorityFeePerGas: this.defaultMaxPriorityFeePerGasGwei,
      };
    }

    try {
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
    if (url.includes("etherscan.io") || url.includes("polygonscan.com")) {
      const isMainnet = url.includes("etherscan.io");
      const etherscanGasResponse = json as EtherscanGasResponse;
      if (etherscanGasResponse.result.suggestBaseFee === undefined)
        throw new Error(`Bad ethgasstation response ${json}`);
      return {
        maxFeePerGas: Number(etherscanGasResponse.result.suggestBaseFee) * 3,
        maxPriorityFeePerGas: isMainnet ? 1 : 50,
      } as LondonGasData;
    } else if (url.includes("gasstation-testnet.polygon.technology")) {
      const maticResponse = json as MumbaiResponseGasStation;
      if (maticResponse?.fast.maxFee === undefined) throw new Error(`Bad matic response ${json}`);
      return {
        maxFeePerGas: Number(maticResponse.estimatedBaseFee) * 3,
        maxPriorityFeePerGas: Number(maticResponse.fast.maxPriorityFee),
      } as LondonGasData;
    } else {
      throw new Error("Unknown api");
    }
  }
}
