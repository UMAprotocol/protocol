// As defined in 1inch
const ALTERNATIVE_ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ONE_SPLIT_ADDRESS = "0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E";

const GAS_LIMIT_BUFFER = 1.25;

const GAS_LIMIT = 8000000;

const MAX_SLIPPAGE = 0.1; // 10% slippage

// Allow up to 1.5% slippage when calculating the inverse amount required.
// This is because we don't have a getInForExactOut in OneSplit as its a DEX aggregator.
const INVERSE_SLIPPAGE = 1.015;

module.exports = {
  ALTERNATIVE_ETH_ADDRESS,
  ONE_SPLIT_ADDRESS,
  GAS_LIMIT,
  GAS_LIMIT_BUFFER,
  MAX_SLIPPAGE,
  INVERSE_SLIPPAGE
};
