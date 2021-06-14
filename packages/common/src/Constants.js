// The interface names that Finder.sol uses to refer to interfaces in the UMA system.
const interfaceName = {
  FinancialContractsAdmin: "FinancialContractsAdmin",
  Oracle: "Oracle",
  Registry: "Registry",
  Store: "Store",
  IdentifierWhitelist: "IdentifierWhitelist",
  CollateralWhitelist: "CollateralWhitelist",
  AddressWhitelist: "CollateralWhitelist",
  OptimisticOracle: "OptimisticOracle",
  Bridge: "Bridge",
  GenericHandler: "GenericHandler",
  MockOracleAncillary: "Oracle",
  SinkOracle: "Oracle",
};

module.exports = {
  // These enforce the maximum number of transactions that can fit within one batch-commit and batch-reveal.
  // Based off the current gas limit from Etherscan over the last 6 months of 9950000,
  // the following maximum batchCommit, batchReveal and retrieveRewards are possible:
  // - batchCommit: 28 commits, 6654676 gas used
  // - batchReveal: 58 commits, 5828051 gas used
  // - retrieveRewards: 129 commits, 3344083 gas used
  // Practically, we set a safe upper bound of 25 batch commits & reveals and 100 retrievals.
  BATCH_MAX_COMMITS: 25,
  BATCH_MAX_REVEALS: 25,
  BATCH_MAX_RETRIEVALS: 100,

  // maximum uint256 value: 2^256 - 1
  MAX_UINT_VAL: "115792089237316195423570985008687907853269984665640564039457584007913129639935",

  // maximum allowance allowed by certain ERC20's like UNI: 2^96 - 1
  MAX_SAFE_ALLOWANCE: "79228162514264337593543950335",

  // Max integer that can be safely stored in a vanilla js int.
  MAX_SAFE_JS_INT: 2147483647,

  // 0x0 contract address
  ZERO_ADDRESS: "0x0000000000000000000000000000000000000000",

  // Names of different interfaces in the Finder.
  interfaceName,

  // Block number of first EMP created.
  // https://etherscan.io/tx/0x741ccbf0f9655b0b71e3842d788d58770bd3eb80c8f5bdf4fdec7cd74a776ea3
  UMA_FIRST_EMP_BLOCK: 10103723,
};
