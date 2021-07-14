// Blacklisted price identifiers that will not automatically display on voter clients.
const IDENTIFIER_BLACKLIST = { SOME_IDENTIFIER: ["1596666977"] };

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
  TEST8DECIMALSANCIL: 8,
  TEST6DECIMALS: 6,
  TEST6DECIMALSANCIL: 6,
};

const getPrecisionForIdentifier = (identifier) => {
  return IDENTIFIER_NON_18_PRECISION[identifier] ? IDENTIFIER_NON_18_PRECISION[identifier] : 18;
};

// The optimistic oracle proposer should skip proposing prices for these identifiers, for expired EMP contracts,
// because they map to self-referential pricefeeds pre-expiry, but have different price resolution ogic post-expiry.
// For example, please see [UMIP47](https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-47.md):
// - "The type of price that the DVM will return is dependent on the timestamp the price request is made at. This
//   timestamp is the expiry timestamp of the contract that is intended to use this price identifier, so the TWAP
//   calculation is used pre-expiry and the closing index value of uSTONKS calculation is used at expiry.""
const OPTIMISTIC_ORACLE_IGNORE_POST_EXPIRY = [
  "TESTBLACKLIST", // Used for testing this list, assumed by tests to be at index 0.
  "uSTONKS_APR21",
  "GASETH-TWAP-1Mx1M",
  "uSTONKS_JUN21",
  "uSTONKS_0921",
];

// Any identifier on this list
const OPTIMISTIC_ORACLE_IGNORE = ["SPACEXLAUNCH", "uTVL_KPI_UMA"];

module.exports = {
  IDENTIFIER_BLACKLIST,
  IDENTIFIER_NON_18_PRECISION,
  getPrecisionForIdentifier,
  OPTIMISTIC_ORACLE_IGNORE_POST_EXPIRY,
  OPTIMISTIC_ORACLE_IGNORE,
};
