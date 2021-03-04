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
  "COMPUSDC-APR-FEB28/USDC": 6,
  "COMPUSDC-APR-MAR28/USDC": 6,
  // The following identifiers are used in local test environments only:
  TEST8DECIMALS: 8,
  TEST6DECIMALS: 6
};

const getPrecisionForIdentifier = identifier => {
  return IDENTIFIER_NON_18_PRECISION[identifier] ? IDENTIFIER_NON_18_PRECISION[identifier] : 18;
};

module.exports = {
  IDENTIFIER_BLACKLIST,
  IDENTIFIER_NON_18_PRECISION,
  getPrecisionForIdentifier
};
