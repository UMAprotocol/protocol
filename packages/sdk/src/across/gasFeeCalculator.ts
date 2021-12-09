import { calculateGasFees, percent, BigNumberish } from "./utils";
import type { SignerOrProvider } from "..";
import { connect as erc20Connect } from "../clients/erc20";
import { Etherchain } from "../clients/etherchain";
import Coingecko from "../coingecko";
import { ethers } from "ethers";

/**
 * Main function to estimate gas fees based on coingecko token price and ethers gasPrice. You must still
 * provide a gas amount estimation based on the usage pattern. See constants for current estimations.
 *
 * @param {SignerOrProvider} ethersProvider
 * @param {BigNumberish} Total amount to be relayed, specified in smallest unit of currency.
 * @param {SignerOrProvider} ethersProvider - a valid ethers provider, used to get gas price and erc20 contract info.
 * @param {number} gas - The gas cost for transfer, use constants defined in constants file.
 * @param {string} [tokenAddress=undefined] - Optional token address, if not provided, defaults to ethereum.
 */
type ReturnType = {
  gasFees: string; // gas fees spent in native token and token decimals
  feesAsPercent: string; // fees as a percentage in wei. 1 ETH = 100%.
};
export default async (
  ethersProvider: SignerOrProvider,
  totalRelayed: BigNumberish,
  gas: number,
  tokenAddress?: string
): Promise<ReturnType> => {
  const latestBlockNumber = await (ethersProvider as ethers.providers.JsonRpcProvider).getBlockNumber();
  const { baseFeePerGas } = await (ethersProvider as ethers.providers.JsonRpcProvider).getBlock(latestBlockNumber);
  let gasPrice: ethers.BigNumber;

  if (baseFeePerGas) {
    const priorityFeePerGas = (await new Etherchain().getGasPrice()).fastest;
    gasPrice = baseFeePerGas.add(priorityFeePerGas);
  } else {
    // fallback in case baseFeePerGas is undefined / null
    gasPrice = await ethersProvider.getGasPrice();
  }

  if (tokenAddress === undefined) {
    const gasFees = calculateGasFees(gas, gasPrice);
    return {
      gasFees,
      feesAsPercent: percent(gasFees, totalRelayed).toString(),
    };
  }
  const coingecko = new Coingecko();
  const [, tokenPrice] = await coingecko.getCurrentPriceByContract(tokenAddress, "eth");
  const erc20Client = erc20Connect(tokenAddress, ethersProvider);
  const decimals = await erc20Client.decimals();
  const gasFees = calculateGasFees(gas, gasPrice, tokenPrice, decimals);

  return {
    gasFees,
    feesAsPercent: percent(gasFees, totalRelayed).toString(),
  };
};
