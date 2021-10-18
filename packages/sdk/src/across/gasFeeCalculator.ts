import { calculateGasFees } from "./utils";
import type { SignerOrProvider } from "..";
import { connect as erc20Connect } from "../clients/erc20";
import Coingecko from "../coingecko";

/**
 * Main function to estimate gas fees based on coingecko token price and ethers gasPrice. You must still
 * provide a gas amount estimation based on the usage pattern. See constants for current estimations.
 *
 * @param {SignerOrProvider} ethersProvider - a valid ethers provider, used to get gas price and erc20 contract info.
 * @param {number} gas - The gas cost for transfer, use constants defined in constants file.
 * @param {string} [tokenAddress=undefined] - Optional token address, if not provided, defaults to ethereum.
 */
export default async (ethersProvider: SignerOrProvider, gas: number, tokenAddress?: string): Promise<string> => {
  const gasPrice = await ethersProvider.getGasPrice();
  if (tokenAddress === undefined) {
    return calculateGasFees(gas, gasPrice);
  }
  const coingecko = new Coingecko();
  const [, tokenPrice] = await coingecko.getCurrentPriceByContract(tokenAddress, "eth");
  const erc20Client = erc20Connect(tokenAddress, ethersProvider);
  const decimals = await erc20Client.decimals();
  return calculateGasFees(gas, gasPrice, tokenPrice, decimals);
};
