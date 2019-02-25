function stateToString(state) {
  switch (state.toString()) {
    case "0":
      return "Live";
    case "1":
      return "Disputed";
    case "2":
      return "Expired";
    case "3":
      return "Defaulted";
    case "4":
      return "Emergency";
    case "5":
      return "Settled";
    default:
      return "Unknown";
  }
}

// Determines whether a contract uses ETH as its margin currency.
// derivativeStorage: `TDS` struct from TokenizedDerivative.sol.
function hasEthMarginCurrency(derivativeStorage) {
  // The TokenizedDerivative smart contract uses this value to indicate using ETH as the margin currency.
  const sentinelMarginCurrency = "0x0000000000000000000000000000000000000000";
  return derivativeStorage.externalAddresses.marginCurrency === sentinelMarginCurrency;
}

module.exports = {
  stateToString,
  hasEthMarginCurrency
};
