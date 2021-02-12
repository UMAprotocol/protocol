// Blacklisted price identifiers that will not automatically display on voter clients.
const IDENTIFIER_BLACKLIST = {
  SOME_IDENTIFIER: ["1596666977"]
};

// Price identifiers that should resolve prices to non 18 decimal precision. Any identifiers
// not on this list are assumed to resolve to 18 decimals.
const IDENTIFIER_NON_18_PRECISION = {
  USDBTC: 8,
  "STABLESPREAD/USDC": 6,
  "STABLESPREAD/BTC": 8,
  "ELASTIC_STABLESPREAD/USDC": 6,
  BCHNBTC: 8,
  AMPLUSD: 6,
  "uVOL-BTC-APR21": 6,
  "BTC-BASIS-3M/USDC": 6,
  "BTC-BASIS-6M/USDC": 6,
  "ETH-BASIS-3M/USDC": 6,
  "ETH-BASIS-6M/USDC": 6,
  "COMPUSDC-APR-FEB28/USDC": 6,
  "COMPUSDC-APR-MAR28/USDC": 6,
  DSDUSD: 6,
  DEFI_PULSE_TOTAL_TVL: 6,
  SUSHIUNI_TVL: 6
};

const getPrecisionForIdentifier = identifier => {
  return IDENTIFIER_NON_18_PRECISION[identifier] ? IDENTIFIER_NON_18_PRECISION[identifier] : 18;
};

module.exports = {
  IDENTIFIER_BLACKLIST,
  IDENTIFIER_NON_18_PRECISION,
  getPrecisionForIdentifier
};
