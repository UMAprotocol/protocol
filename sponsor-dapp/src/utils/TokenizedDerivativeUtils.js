export const ContractStateEnum = {
  LIVE: "0",
  DISPUTED: "1",
  EXPIRED: "2",
  DEFAULTED: "3",
  EMERGENCY: "4",
  SETTLED: "5"
};

export const ReturnTypeEnum = {
  LINEAR: "0",
  COMPOUND: "1"
};

export function stateToString(state) {
  switch (state.toString()) {
    case ContractStateEnum.LIVE:
      return "Live";
    case ContractStateEnum.DISPUTED:
      return "Disputed";
    case ContractStateEnum.EXPIRED:
      return "Expired";
    case ContractStateEnum.DEFAULTED:
      return "Defaulted";
    case ContractStateEnum.EMERGENCY:
      return "Emergency";
    case ContractStateEnum.SETTLED:
      return "Settled";
    default:
      return "Unknown";
  }
}

// Determines whether a contract uses ETH as its margin currency.
// derivativeStorage: `TDS` struct from TokenizedDerivative.sol.
export function hasEthMarginCurrency(derivativeStorage) {
  // The TokenizedDerivative smart contract uses this value to indicate using ETH as the margin currency.
  const sentinelMarginCurrency = "0x0000000000000000000000000000000000000000";
  return derivativeStorage.externalAddresses.marginCurrency === sentinelMarginCurrency;
}
