// these gas costs are estimations, its possible to provide better estimations yourself when invoking getGasFees.
export const SLOW_ETH_GAS = 243177;
export const SLOW_ERC_GAS = 250939;
export const SLOW_UMA_GAS = 273955;

// fast costs are slightly higher and include the slow cost
export const FAST_ETH_GAS = 273519;
export const FAST_ERC_GAS = 281242;
export const FAST_UMA_GAS = 305572;

export interface RateModel {
  UBar: string; // denote the utilization kink along the rate model where the slope of the interest rate model changes.
  R0: string; // is the interest rate charged at 0 utilization
  R1: string; // R_0+R_1 is the interest rate charged at UBar
  R2: string; // R_0+R_1+R_2 is the interest rate charged at 100% utilization
}

export const RATE_MODELS: Record<string, RateModel> = {
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": {
    UBar: "650000000000000000",
    R0: "0",
    R1: "80000000000000000",
    R2: "1000000000000000000",
  },
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": {
    UBar: "800000000000000000",
    R0: "0",
    R1: "40000000000000000",
    R2: "600000000000000000",
  },
  "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828": {
    UBar: "500000000000000000",
    R0: "0",
    R1: "50000000000000000",
    R2: "2000000000000000000",
  },
  "0x3472A5A71965499acd81997a54BBA8D852C6E53d": {
    UBar: "500000000000000000",
    R0: "25000000000000000",
    R1: "25000000000000000",
    R2: "2000000000000000000",
  },
};

export const SECONDS_PER_YEAR = 31557600; // based on 365.25 days per year
export const DEFAULT_BLOCK_DELTA = 10; // look exchange rate up based on 10 block difference by default
