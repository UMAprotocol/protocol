// these gas costs are estimations, its possible to provide better estimations yourself when invoking getGasFees.
export const SLOW_ETH_GAS = 243177;
export const SLOW_ERC_GAS = 250939;
export const SLOW_UMA_GAS = 273955;

// fast costs are slightly higher and include the slow cost
export const FAST_ETH_GAS = 273519;
export const FAST_ERC_GAS = 281242;
export const FAST_UMA_GAS = 305572;

export const RATE_MODELS = {
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
  "0x04fa0d235c4abf4bcf4787af4cf447de572ef828": {
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
