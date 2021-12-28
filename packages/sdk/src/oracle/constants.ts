import { ethers } from "ethers";

export const MULTICALL2_ADDRESS = "0x5ba1e12693dc8f9c48aad8770482f4739beed696";

export enum ChainId {
  MAINNET = 1,
  RINKEBY = 4,
  KOVAN = 42,
  OPTIMISM = 10,
  KOVAN_OPTIMISM = 69,
  ARBITRUM = 42161,
  ARBITRUM_RINKEBY = 421611,
  BOBA = 288,
}

export const AddressZero = ethers.constants.AddressZero;

export const Addresses = {
  [ChainId.MAINNET]: {
    multicall2: "0x5ba1e12693dc8f9c48aad8770482f4739beed696",
    optimisticOracle: "0xC43767F4592DF265B4a9F1a398B97fF24F38C6A6",
    erc20: {
      ETH: AddressZero,
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      UMA: "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828",
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
  },
};
