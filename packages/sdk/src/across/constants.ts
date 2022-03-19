import { ethers } from "ethers";
// these gas costs are estimations, its possible to provide better estimations yourself when invoking getGasFees.
export const SLOW_ETH_GAS = 243177;
export const SLOW_ERC_GAS = 250939;
export const SLOW_UMA_GAS = 273955;

// fast costs are slightly higher and include the slow cost
export const FAST_ETH_GAS = 273519;
export const FAST_ERC_GAS = 281242;
export const FAST_UMA_GAS = 305572;

export const SPEED_UP_ETH_GAS = 195288;
export const SPEED_UP_ERC_GAS = 203011;
export const SPEED_UP_UMA_GAS = 227341;

// Bots incur lower than expected costs due to batching mulitple transactions, this roughly estimates the savings
export const DEFAULT_GAS_DISCOUNT = 25;

export const expectedRateModelKeys = ["UBar", "R0", "R1", "R2"];

// Amount of blocks to wait following a `TokensBridged` L2 event until we check the L1 state commitment contracts. This
// offset provides a buffer to allow for any time delay between L2 state changing and L1 state updating. For example,
// Optimism has a several hour delay.
export const L2_STATE_COMMITMENT_DELAY_BLOCKS = 25000;

export interface RateModel {
  UBar: string; // denote the utilization kink along the rate model where the slope of the interest rate model changes.
  R0: string; // is the interest rate charged at 0 utilization
  R1: string; // R_0+R_1 is the interest rate charged at UBar
  R2: string; // R_0+R_1+R_2 is the interest rate charged at 100% utilization
}

export const AddressZero = ethers.constants.AddressZero;
// mainnet addresses, hard coded here for convenience, but theres probably a better pattern for this
export const ADDRESSES = {
  ETH: AddressZero,
  UMA: "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  RateModel: "0xd18fFeb5fdd1F2e122251eA7Bf357D8Af0B60B50",
};

export const SECONDS_PER_YEAR = 31557600; // based on 365.25 days per year
export const DEFAULT_BLOCK_DELTA = 10; // look exchange rate up based on 10 block difference by default
