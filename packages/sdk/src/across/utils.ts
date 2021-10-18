import { BigNumber, ethers } from "ethers";
import { ConvertDecimals } from "../utils";

export type BigNumberish = string | number | BigNumber;
export type BN = BigNumber;

/**
 * toBN.
 *
 * @param {BigNumberish} num
 * @returns {BN}
 */
export const toBN = (num: BigNumberish): BN => BigNumber.from(num.toString());
/**
 * toBNWei.
 *
 * @param {BigNumberish} num
 * @param {number} decimals
 * @returns {BN}
 */
export const toBNWei = (num: BigNumberish, decimals?: number): BN => ethers.utils.parseUnits(num.toString(), decimals);
/**
 * toWei.
 *
 * @param {BigNumberish} num
 * @param {number} decimals
 * @returns {string}
 */
export const toWei = (num: BigNumberish, decimals?: number): string => toBNWei(num, decimals).toString();
/**
 * fromWei.
 *
 * @param {BigNumberish} num
 * @param {number} decimals
 * @returns {string}
 */
export const fromWei = (num: BigNumberish, decimals?: number): string =>
  ethers.utils.formatUnits(num.toString(), decimals);

/**
 * min.
 *
 * @param {BigNumberish} a
 * @param {BigNumberish} b
 * @returns {BN}
 */
export function min(a: BigNumberish, b: BigNumberish): BN {
  const bna = toBN(a);
  const bnb = toBN(b);
  return bna.lte(bnb) ? bna : bnb;
}
/**
 * max.
 *
 * @param {BigNumberish} a
 * @param {BigNumberish} b
 * @returns {BN}
 */
export function max(a: BigNumberish, b: BigNumberish): BN {
  const bna = toBN(a);
  const bnb = toBN(b);
  return bna.gte(bnb) ? bna : bnb;
}

export const fixedPointAdjustment = toBNWei("1");

/**
 * Convert an amount of eth into a token given price and token decimals.
 *
 * @param {BigNumberish} fromAmount - Amount of eth to convert.
 * @param {string | number} [ price=1 ] - The price as eth per token, ie how much eth can 1 token buy.
 * @param {} [ toDecimals=18 ] - Number of decimals for the token currency.
 * @returns {string} The number of tokens denominated in token decimals in the smallest unit (wei).
 */
export function ethToToken(fromAmount: BigNumberish, price: string | number = 1, toDecimals = 18): string {
  const priceWei = toBNWei(price);
  const toAmount = toBNWei(fromAmount).div(priceWei);
  return ConvertDecimals(18, toDecimals)(toAmount);
}

/**
 * Convert a gas amount and gas price to wei.
 *
 * @param {number} gas - gas amount.
 * @param {BigNumberish} gasPrice - gas price in gwei.
 * @returns {BigNumber} - total fees in wei.
 */
export const gasToEth = (gas: number, gasPrice: BigNumberish): BigNumber => {
  return BigNumber.from(gas).mul(gasPrice);
};

/**
 * getGasFees. Low level pure function call to calculate gas fees.
 *
 * @param {number} gas - The gast cost for transfer, use constants defined in file.
 * @param {BigNumberish} gasPrice - Estimated gas price in wei.
 * @param {string | number} [price = 1] - The price of the token in eth, how much eth can 1 token buy.
 * @param {number} [decimals=18] - Number of decimals of token.
 * @returns {string} - The value of fees native to the token/eth provided, in its smallest unit.
 */
export function calculateGasFees(
  gas: number,
  gasPrice: BigNumberish,
  price: string | number = 1,
  decimals = 18
): string {
  const amountEth = gasToEth(gas, gasPrice);
  return ethToToken(amountEth, price, decimals);
}
