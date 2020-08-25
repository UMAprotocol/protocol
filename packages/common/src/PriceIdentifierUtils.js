// Blacklisted price identifiers that will not automatically display on voter clients.
const IDENTIFIER_BLACKLIST = {
  SOME_IDENTIFIER: ["1596666977"]
};

// Price identifiers that should resolve prices to non 18 decimal precision. Any identifiers
// not on this list are assumed to resolve to 18 decimals.
const IDENTIFIER_NON_18_PRECISION = {
  USDBTC: 8
};

const getPrecisionForIdentifier = identifier => {
  return IDENTIFIER_NON_18_PRECISION[identifier] ? IDENTIFIER_NON_18_PRECISION[identifier] : 18;
};

module.exports = {
  IDENTIFIER_BLACKLIST,
  IDENTIFIER_NON_18_PRECISION,
  getPrecisionForIdentifier
};
