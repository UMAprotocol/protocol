import winston from "winston";
import Web3 from "web3";
const { toWei, toBN, fromWei, toChecksumAddress } = Web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());
const fixedPoint = toBNWei(1);

import { objectMap, createFormatFunction } from "@uma/common";
import { Coingecko, across } from "@uma/sdk";
import { getAddress, getAbi } from "@uma/contracts-node";

import { RelaySubmitType } from "./Relayer";

import type { BN } from "@uma/common";

const formatWei = createFormatFunction(2, 4, false, 18);
const formatGwei = (number: string | number | BN) => createFormatFunction(2, 4, false, 9)(number.toString());

export enum TokenType {
  WETH,
  ERC20,
  UMA,
}

const costs = across.constants;
const costConstants = {
  [TokenType.WETH]: { slow: costs.SLOW_ETH_GAS, speedUp: costs.SPEED_UP_ETH_GAS, instant: costs.FAST_ETH_GAS },
  [TokenType.ERC20]: { slow: costs.SLOW_ERC_GAS, speedUp: costs.SPEED_UP_ERC_GAS, instant: costs.FAST_ERC_GAS },
  [TokenType.UMA]: { slow: costs.SLOW_UMA_GAS, speedUp: costs.SPEED_UP_UMA_GAS, instant: costs.FAST_UMA_GAS },
};

export class ProfitabilityCalculator {
  public l1TokenInfo: { [token: string]: { tokenType: TokenType; tokenEthPrice: BN; decimals: BN } } = {};

  public relayerDiscount: BN;

  private readonly coingecko;

  /**
   * @notice Constructs new Profitability Calculator Instance.
   * @param {Object} logger Module used to send logs.
   * @param {Array }l1Tokens list of L1 tokens the relayer is running on. Profitability module will store the prices of
   * these tokens and use them when computing if a relay should be executed or not.
   * @param {Number} l1ChainId L1 chain id that the relayer is running on.
   * @param {Number} relayerDiscount Relayer discount applied to relays to offset gas cost.
   */
  constructor(
    readonly logger: winston.Logger,
    readonly l1Tokens: string[],
    readonly l1ChainId: number,
    readonly l1Web3: Web3,
    readonly relayerDiscountNumber: number = 0
  ) {
    this.relayerDiscount = toBNWei(Math.floor(relayerDiscountNumber)).div(toBN("100"));
    if (this.relayerDiscount.lt(toBN(0)) || this.relayerDiscount.gt(toBNWei(1)))
      throw new Error("Bad discount factor! 0<=relayerDiscount<=1e18");

    this.coingecko = new Coingecko();
  }

  async update() {
    this.logger.debug({ at: "ProfitabilityCalculator", message: "Updating prices", tokenList: this.l1Tokens });

    // If the l1TokenInfo is empty then this is the first run. Figure out the token types of each l1Token.
    if (Object.keys(this.l1TokenInfo).length == 0) {
      const [umaAddress, wethAddress] = await Promise.all([
        await getAddress("VotingToken", this.l1ChainId),
        await getAddress("WETH9", this.l1ChainId),
      ]);
      for (const l1Token of this.l1Tokens) {
        this.l1TokenInfo[l1Token] = { tokenType: TokenType.ERC20, tokenEthPrice: toBNWei("1"), decimals: toBN("18") };
        if (l1Token == toChecksumAddress(umaAddress)) this.l1TokenInfo[l1Token].tokenType = TokenType.UMA;
        else if (l1Token == toChecksumAddress(wethAddress)) this.l1TokenInfo[l1Token].tokenType = TokenType.WETH;
      }

      // Set decimals for each token. Only run if l1TokenInfo is empty (i.e first run).
      await Promise.all(
        this.l1Tokens.map(async (l1Token) => {
          const erc20 = new this.l1Web3.eth.Contract(getAbi("ERC20"), l1Token);
          const decimals = await erc20.methods.decimals().call();
          this.l1TokenInfo[l1Token].decimals = toBN(decimals.toString());
        })
      );
    }

    // Fetch the prices of each token, denominated in ETH. If coingecko does not have the price or is down then this
    // call will fail and the tokenPrices array will have this error. Note that Coingecko could also rate limit this
    // call. TODO: consider dealing with Coingecko rate limiting.
    const tokenPrices = await Promise.allSettled(
      this.l1Tokens.map((l1Token) => this.coingecko.getCurrentPriceByContract(l1Token, "eth"))
    );

    // For each token, extract the price and convert to a wei'd BN. Note that if the type is WETH then the price is 1.
    // This is done as coingecko does not always return the price of 1 for WETH, in ETH. Note that if the status is not
    // fulfilled then the call failed. In this case we dont have pricing information for this token. Set price to 0 to
    // not send arrays (always will be unprofitable) and generate a warning.
    for (const [index, priceResponse] of tokenPrices.entries()) {
      if (priceResponse.status == "fulfilled") {
        this.l1TokenInfo[this.l1Tokens[index]].tokenEthPrice =
          this.l1TokenInfo[this.l1Tokens[index]].tokenType == TokenType.WETH
            ? toBNWei("1")
            : toBNWei(priceResponse.value[1]);
      } else {
        this.l1TokenInfo[this.l1Tokens[index]].tokenEthPrice = toBNWei("0");
        this.logger.warn({
          at: "ProfitabilityCalculator",
          message: "Could not find token price!",
          token: this.l1Tokens[index],
        });
      }
    }

    this.logger.debug({
      at: "ProfitabilityCalculator",
      message: "Updated prices",
      tokenInfo: objectMap(this.l1TokenInfo, (value: { tokenType: TokenType; tokenEthPrice: BN }) => {
        return { tokenType: TokenType[value.tokenType], tokenEthPrice: fromWei(value.tokenEthPrice) };
      }),
    });
  }

  getRelaySubmitTypeBasedOnProfitability(
    l1Token: string,
    cumulativeGasPrice: BN, // sum of the most recent base fee per gas and the current estimated maxPriorityFeePerGas.
    slowRevenue: BN,
    speedUpRevenue: BN,
    instantRevenue: BN
  ): { relaySubmitType: RelaySubmitType; profitabilityInformation: string } {
    this._throwIfNotInitialized();
    if (!this.l1TokenInfo[l1Token]) throw new Error("Token info not found. Ensure to construct correctly");
    const { tokenType, tokenEthPrice, decimals } = this.l1TokenInfo[l1Token];

    // If the relayer discount is 100% then we can relay tokens with a price of 0. Else, if the price is zero then there
    // is no way that this is a profitable relay. In this case, error out.
    if (this.relayerDiscountNumber != 100 && tokenEthPrice.toString() == "0")
      throw new Error("Token price stored at 0. Cant consider profit.");

    this.logger.debug({
      at: "ProfitabilityCalculator",
      message: "Considering relay profitability",
      l1Token,
      tokenType: TokenType[tokenType],
      tokenEthPrice: fromWei(tokenEthPrice),
      tokenDecimals: decimals.toString(),
      cumulativeGasPrice: cumulativeGasPrice.toString(),
      relayerDiscount: fromWei(this.relayerDiscount),
      slowRevenue: slowRevenue.toString(),
      speedUpRevenue: speedUpRevenue.toString(),
      instantRevenue: instantRevenue.toString(),
    });

    // Calculate the transaction submission costs depending on the gas price and the token type being relayed. This
    // considers the relayer discount, applied to all relay actions equally.
    const ethSubmissionCost = this.getRelayEthSubmissionCost(cumulativeGasPrice, tokenType);

    // Calculate the expected revenue, in ETH, based on the amount of tokens being offered in fees.
    const ethRevenue = this.getEthRevenue(tokenEthPrice, slowRevenue, speedUpRevenue, instantRevenue, decimals);

    // Calculate the relay profitability as the difference between revenue and cost.
    const ethProfitability = this.getProfit(ethSubmissionCost, ethRevenue);

    // Finally, determine the relay submit type based on the profitability.
    let relaySubmitType: RelaySubmitType;
    if (
      ethProfitability.instantEthProfit.gt(toBN(0)) &&
      ethProfitability.instantEthProfit.gt(ethProfitability.slowEthProfit)
    )
      relaySubmitType = RelaySubmitType.Instant;
    else if (ethProfitability.speedUpEthProfit.gt(toBN(0))) relaySubmitType = RelaySubmitType.SpeedUp;
    else if (ethProfitability.slowEthProfit.gt(toBN(0))) relaySubmitType = RelaySubmitType.Slow;
    else relaySubmitType = RelaySubmitType.Ignore;

    const profitabilityInformation = this._generateProfitabilityInformation(
      relaySubmitType,
      tokenType,
      this.relayerDiscount,
      cumulativeGasPrice,
      ethProfitability,
      ethRevenue
    );

    this.logger.debug({
      at: "ProfitabilityCalculator",
      message: "Considered relay profitability",
      l1Token,
      tokenType: TokenType[tokenType],
      tokenEthPrice: fromWei(tokenEthPrice),
      cumulativeGasPrice: cumulativeGasPrice.toString(),
      relayerDiscount: fromWei(this.relayerDiscount),
      ethSubmissionCost: objectMap(ethSubmissionCost, (value: BN) => fromWei(value)),
      ethRevenue: objectMap(ethRevenue, (value: BN) => fromWei(value)),
      ethProfitability: objectMap(ethProfitability, (value: BN) => fromWei(value)),
      relaySubmitType: RelaySubmitType[relaySubmitType],
      profitabilityInformation,
    });

    return { relaySubmitType, profitabilityInformation };
  }

  getRelayEthSubmissionCost(
    cumulativeGasPrice: BN,
    tokenType: TokenType
  ): {
    slowEThCost: BN;
    speedUpEthCost: BN;
    instantEthCost: BN;
  } {
    const discount = fixedPoint.sub(this.relayerDiscount);
    return {
      slowEThCost: cumulativeGasPrice.mul(toBN(costConstants[tokenType].slow)).mul(discount).div(fixedPoint),
      speedUpEthCost: cumulativeGasPrice.mul(toBN(costConstants[tokenType].speedUp)).mul(discount).div(fixedPoint),
      instantEthCost: cumulativeGasPrice.mul(toBN(costConstants[tokenType].instant)).mul(discount).div(fixedPoint),
    };
  }

  getRelayBreakEvenGasPrice(
    tokenType: TokenType,
    ethRevenue: { slowEthRevenue: BN; speedUpEthRevenue: BN; instantEthRevenue: BN }
  ): {
    slowBreakEvenGasPrice: BN;
    speedUpBreakEvenGasPrice: BN;
    instantBreakEvenGasPrice: BN;
  } {
    const discount = fixedPoint.sub(this.relayerDiscount);
    return {
      slowBreakEvenGasPrice: ethRevenue.slowEthRevenue.eq(toBN("0"))
        ? toBN("0")
        : ethRevenue.slowEthRevenue.div(toBN(costConstants[tokenType].slow).mul(discount).div(fixedPoint)),
      speedUpBreakEvenGasPrice: ethRevenue.speedUpEthRevenue.eq(toBN("0"))
        ? toBN("0")
        : ethRevenue.speedUpEthRevenue.div(toBN(costConstants[tokenType].speedUp).mul(discount).div(fixedPoint)),
      instantBreakEvenGasPrice: ethRevenue.instantEthRevenue.eq(toBN("0"))
        ? toBN("0")
        : ethRevenue.instantEthRevenue.div(toBN(costConstants[tokenType].instant).mul(discount).div(fixedPoint)),
    };
  }
  getEthRevenue(
    tokenPrice: BN,
    slowRevenue: BN,
    speedUpRevenue: BN,
    instantRevenue: BN,
    tokenDecimals: BN
  ): {
    slowEthRevenue: BN;
    speedUpEthRevenue: BN;
    instantEthRevenue: BN;
  } {
    const tokenDecimalMultiplier = toBN(10).pow(tokenDecimals);
    return {
      slowEthRevenue: slowRevenue.mul(tokenPrice).div(tokenDecimalMultiplier),
      speedUpEthRevenue: speedUpRevenue.mul(tokenPrice).div(tokenDecimalMultiplier),
      instantEthRevenue: instantRevenue.mul(tokenPrice).div(tokenDecimalMultiplier),
    };
  }

  getProfit(
    relayCosts: {
      slowEThCost: BN;
      speedUpEthCost: BN;
      instantEthCost: BN;
    },
    relayRevenues: {
      slowEthRevenue: BN;
      speedUpEthRevenue: BN;
      instantEthRevenue: BN;
    }
  ): {
    slowEthProfit: BN;
    speedUpEthProfit: BN;
    instantEthProfit: BN;
  } {
    return {
      slowEthProfit: relayRevenues.slowEthRevenue.sub(relayCosts.slowEThCost),
      speedUpEthProfit: relayRevenues.speedUpEthRevenue.sub(relayCosts.speedUpEthCost),
      instantEthProfit: relayRevenues.instantEthRevenue.sub(relayCosts.instantEthCost),
    };
  }

  private _throwIfNotInitialized() {
    if (Object.keys(this.l1TokenInfo).length != this.l1Tokens.length)
      throw new Error("ProfitabilityCalculator method called before initialization! Call `update` first.");
  }

  private _generateProfitabilityInformation(
    relaySubmitType: RelaySubmitType,
    tokenType: TokenType,
    relayerDiscount: BN,
    cumulativeGasPrice: BN,
    ethProfitability: { slowEthProfit: BN; speedUpEthProfit: BN; instantEthProfit: BN },
    ethRevenue: { slowEthRevenue: BN; speedUpEthRevenue: BN; instantEthRevenue: BN }
  ): string {
    if (relaySubmitType != RelaySubmitType.Ignore) {
      const profitInEth =
        relaySubmitType == RelaySubmitType.Slow
          ? ethProfitability.slowEthProfit
          : relaySubmitType == RelaySubmitType.SpeedUp
          ? ethProfitability.speedUpEthProfit
          : ethProfitability.instantEthProfit;

      return (
        "Expected relay profit of " +
        formatWei(profitInEth) +
        " ETH for " +
        RelaySubmitType[relaySubmitType] +
        " relay, with a relayerDiscount of " +
        fromWei(relayerDiscount.muln(100)) +
        "%."
      );
    } else {
      const relayBreakEvenGasPrice = this.getRelayBreakEvenGasPrice(tokenType, ethRevenue);

      return (
        "SlowRelay profit " +
        formatWei(ethProfitability.slowEthProfit) +
        " ETH, SpeedUpRelay profit " +
        formatWei(ethProfitability.speedUpEthProfit) +
        " ETH and InstantRelay profit " +
        formatWei(ethProfitability.instantEthProfit) +
        " ETH, with a relayerDiscount of " +
        fromWei(relayerDiscount.muln(100)) +
        "%. Current cumulativeGasPrice is " +
        formatGwei(cumulativeGasPrice) +
        " Gwei. Relay would be break even at gas price of SlowRelay " +
        formatGwei(relayBreakEvenGasPrice.slowBreakEvenGasPrice) +
        " Gwei, SpeedUpRelay " +
        formatGwei(relayBreakEvenGasPrice.speedUpBreakEvenGasPrice) +
        " Gwei and InstantRelay " +
        formatGwei(relayBreakEvenGasPrice.instantBreakEvenGasPrice) +
        " Gwei."
      );
    }
  }
}
