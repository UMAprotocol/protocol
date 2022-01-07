import assert from "assert";
import { calculateGasFees, percent, BigNumberish, toBNWei, fixedPointAdjustment, toWei } from "./utils";
import { exists } from "../utils";
import { Provider } from "@ethersproject/providers";
import { connect as erc20Connect } from "../clients/erc20";
import { Etherchain } from "../clients/etherchain";
import Coingecko from "../coingecko";
import { ethers, BigNumber } from "ethers";
import * as constants from "./constants";

/**
 * Function to estimate gas fees based on coingecko token price and ethers gasPrice. You must still
 * provide a gas amount estimation based on the usage pattern. See constants for current estimations. Returns
 * an amount of gas estimated in the token provided in wei.
 *
 * @param {Provider} ethers Provider
 * @param {BigNumberish} Total amount to be relayed, specified in smallest unit of currency.
 * @param {number} gas - The gas cost for transfer, use constants defined in constants file.
 * @param {string} [tokenAddress = constants.ADDRESSES.ETH] - Token address, for ETH, constants.ADDRESSES.ETH
 */
export async function getGasFee(
  ethersProvider: Provider,
  gas: number,
  tokenAddress: string = constants.ADDRESSES.ETH
): Promise<string> {
  const { baseFeePerGas } = await ethersProvider.getBlock("latest");
  let gasPrice: ethers.BigNumber;

  if (baseFeePerGas) {
    const priorityFeePerGas = (await new Etherchain().getGasPrice()).fastest;
    // transform priority fee from gwei (eg 4.1) to wei
    const priorityFeePerGasWei = toWei(priorityFeePerGas, 9);
    gasPrice = baseFeePerGas.add(priorityFeePerGasWei);
  } else {
    // fallback in case baseFeePerGas is undefined / null
    gasPrice = await ethersProvider.getGasPrice();
  }

  // We treat ETH differently since we dont need a price conversion like other tokens and return early.
  if (tokenAddress === constants.ADDRESSES.ETH) {
    return calculateGasFees(gas, gasPrice);
  }
  const coingecko = new Coingecko();
  const [, tokenPrice] = await coingecko.getCurrentPriceByContract(tokenAddress, "eth");
  const erc20Client = erc20Connect(tokenAddress, ethersProvider);
  const decimals = await erc20Client.decimals();
  return calculateGasFees(gas, gasPrice, tokenPrice, decimals);
}

type GasTable = Record<string, number> & { DEFAULT: number };
// These tables are hard coded to mainnet
function makeSlowGasTable(): GasTable {
  return {
    [constants.ADDRESSES.UMA]: constants.SLOW_UMA_GAS,
    [constants.ADDRESSES.ETH]: constants.SLOW_ETH_GAS,
    [constants.ADDRESSES.WETH]: constants.SLOW_ETH_GAS,
    DEFAULT: constants.SLOW_ERC_GAS,
  };
}
// instant gas is the amount of gas above slow gas
function makeInstantGasTable(): GasTable {
  return {
    [constants.ADDRESSES.UMA]: constants.FAST_UMA_GAS - constants.SLOW_UMA_GAS,
    [constants.ADDRESSES.ETH]: constants.FAST_ETH_GAS - constants.SLOW_ETH_GAS,
    [constants.ADDRESSES.WETH]: constants.FAST_ETH_GAS - constants.SLOW_ETH_GAS,
    DEFAULT: constants.FAST_ERC_GAS - constants.SLOW_ERC_GAS,
  };
}

const GetGasByAddress = (gasTable: GasTable) => (tokenAddress: string): number => {
  if (exists(gasTable[tokenAddress])) return gasTable[tokenAddress];
  return gasTable.DEFAULT;
};

export const getInstantGasByAddress = GetGasByAddress(makeInstantGasTable());
export const getSlowGasByAddress = GetGasByAddress(makeSlowGasTable());

export type DepositFees = {
  slowPct: string;
  instantPct: string;
};

/**
 * getDepositFees. Returns to you appropriate values for calling the relay deposit function. Returns the slow gas fee
 * and the instant gas fee which is the amount additional to the slow fee as percentages in wei.
 *
 * @param {Provider} ethersProvider - Read provider on mainnet
 * @param {BigNumberish} amountToRelay - Amount in wei of token to relay
 * @param {string} tokenAddress = 0 - Mainnet address of token to relay. Defaults to ETH which is constants.ADDRESSES.ETH.
 * @param {string} discountPercent = DEFAULT_GAS_DISCOUNT- Percent as a value 0-100 of gas fee discount. 0 means no discount. Typically 25 for a 25% gas fee reduction.
 * No need to override this as the values are hardcoded in the sdk.
 * @returns {Promise<DepositFees>} - Returns the fee parameters to the deposit function on the deposit box contract.
 * These are percentages in wei. For example 50% is represented as 0.5 * 1e18.
 */
export async function getDepositFees(
  ethersProvider: Provider,
  amountToRelay: BigNumberish,
  tokenAddress: string = constants.ADDRESSES.ETH,
  discountPercent: number = constants.DEFAULT_GAS_DISCOUNT
): Promise<DepositFees> {
  assert(discountPercent >= 0 && discountPercent <= 100, "discountPercent must be between 0 and 100 percent");
  const slowGas = getSlowGasByAddress(tokenAddress);
  const slowGasDiscounted = Math.floor((1 - discountPercent / 100) * slowGas);
  const slowGasFee = await getGasFee(ethersProvider, slowGasDiscounted, tokenAddress);

  const instantGas = getInstantGasByAddress(tokenAddress);
  const instantGasDiscounted = Math.floor((1 - discountPercent / 100) * instantGas);
  const instantGasFee = await getGasFee(ethersProvider, instantGasDiscounted, tokenAddress);

  return {
    slowPct: percent(slowGasFee, amountToRelay).toString(),
    instantPct: percent(instantGasFee, amountToRelay).toString(),
  };
}

export type DepositFeeDetails = {
  tokenAddress: string;
  amountToRelay: string;
  discountPercent: number;
  feeLimitPercent?: number;
  instant: {
    pct: string;
    total: string;
  };
  slow: {
    pct: string;
    total: string;
  };
  isAmountTooLow: boolean;
};
/**
 * getDepositFeesDetails. Same as deposit fees, but returns more information, useful for a frontend display.
 *
 * @param {Provider} ethersProvider - Read provider on mainnet
 * @param {BigNumberish} amountToRelay - Amount in wei of token to relay
 * @param {string} tokenAddress = 0 - Mainnet address of token to relay, for ETH specify constants.ADDRESSES.ETH
 * @param {number} feeLimitPercent? - Optional, percent as a value 0-100 of how much to limit fees as a percentage of the total relayed. Typically 25 or 25% of fees are acceptable out of the total relay amount.
 * For instance 25 means fees can be up to 25% of the total amount to send, fees above this will cause isAmountTooLow to be true.
 * @param {string} discountPercent = DEFAULT_GAS_DISCOUNT - Percent as a value 0-100 of gas fee discount. 0 means no discount. Typically 25 for a 25% gas fee reduction.
 * No need to override this as the values are hardcoded in the sdk.
 * @returns {DepositFeeDetails}
 */
export async function getDepositFeesDetails(
  ethersProvider: Provider,
  amountToRelay: BigNumberish,
  tokenAddress: string = constants.ADDRESSES.ETH,
  feeLimitPercent?: number,
  discountPercent: number = constants.DEFAULT_GAS_DISCOUNT
): Promise<DepositFeeDetails> {
  const { slowPct, instantPct } = await getDepositFees(ethersProvider, amountToRelay, tokenAddress, discountPercent);
  const slowTotal = BigNumber.from(slowPct).mul(amountToRelay).div(fixedPointAdjustment).toString();
  const instantTotal = BigNumber.from(instantPct).mul(amountToRelay).div(fixedPointAdjustment).toString();
  let isAmountTooLow = false;

  if (feeLimitPercent) {
    assert(feeLimitPercent >= 0 && feeLimitPercent <= 100, "feeLimitPercent must be between 0 and 100 percent");
    isAmountTooLow = BigNumber.from(slowPct)
      .add(instantPct)
      .gt(toBNWei(feeLimitPercent / 100));
  }

  return {
    amountToRelay: amountToRelay.toString(),
    discountPercent,
    feeLimitPercent,
    tokenAddress,
    instant: {
      pct: instantPct,
      total: instantTotal,
    },
    slow: {
      pct: slowPct,
      total: slowTotal,
    },
    isAmountTooLow,
  };
}
