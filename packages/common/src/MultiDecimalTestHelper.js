// Run the tests against 2 different kinds of token/synth decimal combinations:
// 1) matching 18 collateral & 18 synthetic decimals with 18 decimals for price feed.
// 3) matching 8 collateral & 8 synthetic decimals with 18 decimals for price feed.
const TEST_DECIMAL_COMBOS = [
  {
    tokenSymbol: "WETH",
    tokenName: "Wrapped Ether",
    collateralDecimals: 18,
    syntheticDecimals: 18,
    priceFeedDecimals: 18,
  },
  {
    tokenSymbol: "BTC",
    tokenName: "Wrapped BTC",
    collateralDecimals: 8,
    syntheticDecimals: 8,
    priceFeedDecimals: 18,
  },
];

module.exports = { TEST_DECIMAL_COMBOS };
