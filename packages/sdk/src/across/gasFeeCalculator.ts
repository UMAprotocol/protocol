import { BigNumber } from "ethers";
import { ConvertDecimals } from "../utils";
import { toBNWei, BigNumberish } from "./utils";

// these gas costs are estimations, its possible to provide better estimations yourself when invoking getGasFees.
export const SLOW_ETH_GAS = 243177;
export const SLOW_ERC_GAS = 250939;
export const SLOW_UMA_GAS = 273955;

// fast costs are slightly higher and include the slow cost
export const FAST_ETH_GAS = 273519;
export const FAST_ERC_GAS = 281242;
export const FAST_UMA_GAS = 305572;

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
  return BigNumber.from(gas).mul(ConvertDecimals(9, 18)(gasPrice));
};

/**
 * getGasFees. Main entrypoint to estimate total gas fees for a relay across chains.
 *
 * @param {number} gas - The gast cost for transfer, use constants defined in file.
 * @param {BigNumberish} gasPrice - Estimated gas price in gwei.
 * @param {string | number} [price = 1] - The price of the token in eth, how much eth can 1 token buy.
 * @param {number} [decimals=18] - Number of decimals of token.
 * @returns {string} - The value of fees native to the token/eth provided, in its smallest unit.
 */
export function getGasFees(gas: number, gasPrice: BigNumberish, price: string | number = 1, decimals = 18): string {
  const amountEth = gasToEth(gas, gasPrice);
  return ethToToken(amountEth, price, decimals);
}
