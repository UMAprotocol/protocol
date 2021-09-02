import { parseFixed } from "@uma/common";
import { PriceFeedInterface } from "./PriceFeedInterface";
import assert from "assert";
import type { Logger } from "winston";
import Web3 from "web3";
import { NetworkerInterface } from "./Networker";
import { BN } from "../types";

// An implementation of PriceFeedInterface that uses DefiPulse Data api to retrieve prices.
export class DefiPulsePriceFeed extends PriceFeedInterface {
  private readonly uuid: string;
  private readonly toWei = Web3.utils.toWei;
  private historicalPrices: { timestamp: number; tvlUSD: number }[] = [];
  private currentPrice: BN | null = null;
  private lastUpdateTime: number | null = null;

  /**
   * @notice Constructs price feeds for projects listed on DefiPulse.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} defipulseApiKey DeFiPulse Data API key. Note: these API keys are rate-limited.
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   * @param {String} project Project name that we want to query TVL for.
   */
  constructor(
    private readonly logger: Logger,
    private readonly web3: Web3,
    private readonly defipulseApiKey: string,
    private readonly lookback: number,
    private readonly networker: NetworkerInterface,
    private readonly getTime: () => Promise<number>,
    private readonly minTimeBetweenUpdates: number,
    private readonly priceFeedDecimals = 18,
    private readonly project: string
  ) {
    super();
    this.uuid = `DefiPulse ${project}`;

    this.project = project;
    const VALID_PROJECTS = ["all", "SushiSwap", "Uniswap"];
    assert(VALID_PROJECTS.includes(this.project), "invalid project name");
  }

  public getCurrentPrice(): BN | null {
    return this.currentPrice;
  }

  public async getHistoricalPrice(time: number): Promise<BN> {
    if (this.lastUpdateTime === undefined) {
      throw new Error(`${this.uuid}: undefined lastUpdateTime`);
    }

    const closestTime = { timestamp: 0, tvlUSD: 0 };

    // Go through all values and find time that that is the largest and still less than 'time'
    for (let i = 0; i < this.historicalPrices.length; i++) {
      const past = this.historicalPrices[i].timestamp;
      const val = this.historicalPrices[i].tvlUSD;

      if (past > closestTime.timestamp && past < time) {
        closestTime.timestamp = past;
        closestTime.tvlUSD = val;
      }
    }

    const historicalPrice = this.scaleResult(closestTime.tvlUSD);

    if (closestTime.timestamp === 0) {
      throw new Error(`${this.uuid}: No cached time found for timestamp: ${time}`);
    } else {
      return historicalPrice;
    }
  }

  public getLastUpdateTime(): number | null {
    return this.lastUpdateTime;
  }

  public async update(): Promise<void> {
    const currentTime = await this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== null && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "DefiPulsePriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTime + this.minTimeBetweenUpdates - currentTime,
      });
      return;
    }

    this.logger.debug({
      at: "DefiPulsePriceFeed",
      message: "Updating",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime,
    });

    // 1. Construct URLs.
    const priceUrl = `https://data-api.defipulse.com/api/v1/defipulse/api/GetHistory?project=${this.project}&period=1w&api-key=${this.defipulseApiKey}`;

    // 2. Send requests.
    const response = await this.networker.getJson(priceUrl);

    // 3. Check responses.
    if (!response) {
      throw new Error(`🚨Could not parse price result from url ${priceUrl}: ${JSON.stringify(response)}`);
    }

    // 4. Parse results.
    // Return data structure:
    //        [{
    //            "timestamp":"1611511200"
    //            "tvlUSD":25583565042,
    //             ...
    //          },
    //           {
    //            "timestamp":"1611507600",
    //            "tvlUSD":25177860561
    //             ...
    //          },
    //        ]

    // Get tvlUSD for most most recent timestamp
    const mostRecent = { timestamp: 0, tvlUSD: 0 };
    for (let i = 0; i < response.length; i++) {
      if (Number(response[i].timestamp) > mostRecent.timestamp) {
        mostRecent.timestamp = Number(response[i].timestamp);
        mostRecent.tvlUSD = Number(response[i].tvlUSD);
      }
    }

    const newPrice = this.scaleResult(mostRecent.tvlUSD);

    // 5. Store results.
    this.lastUpdateTime = currentTime;
    this.currentPrice = newPrice;
    this.historicalPrices = response;
  }

  private scaleResult(_tvlUSD: number): BN {
    // As described in UMIP 24
    // In an effort to make the token price affordable, the value of the token is the tvlUSD divided by 1 billion.
    // We also cut off precision after 3 decimals to match the specified price step of .001

    const billion = 1000000000;

    const precision = 3;
    assert(
      precision <= this.priceFeedDecimals,
      `Precision of ${precision} is > priceFeedDecimals of ${this.priceFeedDecimals}. Cannot have more precision than decimals`
    );
    const decimalValue = (_tvlUSD / billion).toFixed(precision);
    const fixedPointValue = parseFixed(decimalValue.toString(), this.priceFeedDecimals);
    return this.web3.utils.toBN(fixedPointValue.toString());
  }

  public getPriceFeedDecimals(): number {
    return this.priceFeedDecimals;
  }

  public getLookback(): number {
    return this.lookback;
  }
}
