import { calculateGasFees, percent, BigNumberish } from "./utils";
import { exists } from "../utils";
import { Provider } from "@ethersproject/providers";
import { connect as erc20Connect } from "../clients/erc20";
import { Etherchain } from "../clients/etherchain";
import Coingecko from "../coingecko";
import { ethers } from "ethers";
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
    const priorityFeePerGasWei = Math.round(priorityFeePerGas * 10 ** 9);
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
    [constants.ADDRESSES.WETH]: constants.SLOW_ERC_GAS,
    DEFAULT: constants.SLOW_ERC_GAS,
  };
}
// instant gas is the amount of gas above slow gas
function makeInstantGasTable(): GasTable {
  return {
    [constants.ADDRESSES.UMA]: constants.FAST_UMA_GAS - constants.SLOW_UMA_GAS,
    [constants.ADDRESSES.ETH]: constants.FAST_ETH_GAS - constants.SLOW_ETH_GAS,
    [constants.ADDRESSES.WETH]: constants.FAST_ERC_GAS - constants.SLOW_ERC_GAS,
    DEFAULT: constants.FAST_ERC_GAS - constants.SLOW_ERC_GAS,
  };
}

const GetGasByAddress = (gasTable: GasTable) => (tokenAddress: string): number => {
  if (exists(gasTable[tokenAddress])) return gasTable[tokenAddress];
  return gasTable.DEFAULT;
};

export const getInstantGasByAddress = GetGasByAddress(makeInstantGasTable());
export const getSlowGasByAddress = GetGasByAddress(makeSlowGasTable());

type DepositFees = {
  slowPct: string;
  instantPct: string;
};

/**
 * getDepositFees. Returns to you appropriate values for calling the relay deposit function. Returns the slow gas fee
 * and the instant gas fee which is the amount additional to the slow fee as percentages in wei.
 *
 * @param {Provider} ethersProvider - Read provider on mainnet
 * @param {BigNumberish} amountToRelay - Amount in wei of token to relay
 * @param {string} tokenAddress - Mainnet address of token to relay, for ETH specify constants.ADDRESSES.ETH
 * @returns {Promise<DepositFees>} - Returns the fee parameters to the deposit function on the deposit box contract.
 * These are percentages in wei. For example 50% is represented as 0.5 * 1e18.
 */
export async function getDepositFees(
  ethersProvider: Provider,
  amountToRelay: BigNumberish,
  tokenAddress: string = constants.ADDRESSES.ETH
): Promise<DepositFees> {
  const slowGas = getSlowGasByAddress(tokenAddress);
  const instantGas = getInstantGasByAddress(tokenAddress);
  const slowGasFee = await getGasFee(ethersProvider, slowGas, tokenAddress);
  const instantGasFee = await getGasFee(ethersProvider, instantGas, tokenAddress);
  return {
    slowPct: percent(slowGasFee, amountToRelay).toString(),
    instantPct: percent(instantGasFee, amountToRelay).toString(),
  };
}
