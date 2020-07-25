const EMP_ADDRESS = process.env.EMP_ADDRESS;

// Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
const POLLING_DELAY = process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60;

// Read price feed configuration from an environment variable. This can be a crypto watch, medianizer or uniswap
// price feed Config defines the exchanges to use. If not provided then the bot will try and infer a price feed
// from the EMP_ADDRESS. EG with medianizer: {"type":"medianizer","pair":"ethbtc",
// "lookback":7200, "minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"},
// {"type":"cryptowatch","exchange":"binance"}]}
const PRICE_FEED_CONFIG = process.env.PRICE_FEED_CONFIG ? JSON.parse(process.env.PRICE_FEED_CONFIG) : null;

// If there is a disputer config, add it. Else, set to null. This config contains crThreshold,liquidationDeadline,
// liquidationMinPrice, txnGasLimit & logOverrides. Example config:
// {"crThreshold":0.02,  -> Liquidate if a positions collateral falls more than this % below the min CR requirement
//   "liquidationDeadline":300, -> Aborts if the transaction is mined this amount of time after the last update
//   "liquidationMinPrice":0, -> Aborts if the amount of collateral in the position per token is below this ratio
//   "txnGasLimit":9000000 -> Gas limit to set for sending on-chain transactions.
//   "logOverrides":{"positionLiquidated":"warn"}} -> override specific events log levels.
const LIQUIDATOR_CONFIG = process.env.LIQUIDATOR_CONFIG ? JSON.parse(process.env.LIQUIDATOR_CONFIG) : null;

// If there is a LIQUIDATOR_OVERRIDE_PRICE environment variable then the liquidator will disregard the price from the
// price feed and preform liquidations at this override price. Use with caution as wrong input could cause invalid liquidations.
const LIQUIDATOR_OVERRIDE_PRICE = process.env.LIQUIDATOR_OVERRIDE_PRICE;

// Default OneSplit address
const ONE_SPLIT_ADDRESS = process.env.ONE_INCH_ADDRESS
  ? process.env.ONE_INCH_ADDRESS
  : "0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E";

module.exports = {
  EMP_ADDRESS,
  ONE_SPLIT_ADDRESS,
  POLLING_DELAY,
  PRICE_FEED_CONFIG,
  LIQUIDATOR_CONFIG,
  LIQUIDATOR_OVERRIDE_PRICE
};
