const browserSafe = {
  ...require("./src/AbiUtils"),
  ...require("./src/AdminUtils"),
  ...require("./src/Constants"),
  ...require("./src/ContractUtils"),
  ...require("./src/Crypto"),
  ...require("./src/EmpUtils"),
  ...require("./src/EncryptionHelper"),
  ...require("./src/Enums"),
  ...require("./src/FormattingUtils"),
  ...require("./src/ObjectUtils"),
  ...require("./src/PublicNetworks"),
  ...require("./src/Random"),
  ...require("./src/SolcoverConfig"),
  ...require("./src/SolidityTestUtils"),
  ...require("./src/TimeUtils"),
  ...require("./src/VotingUtils"),
  ...require("./src/PriceIdentifierUtils"),
  ...require("./src/FindContractVersion")
};

// Note: there are some webpack performance downsides to stripping the module this way, but for now it's more readable
// to keep it all in one file. This check is currently done for safety rather than performance.
if (process.browser) {
  module.exports = browserSafe;
} else {
  // Note: these need to be declared inside the else so webpack will ignore.
  const browserUnsafe = {
    ...require("./src/gckms/ManagedSecretProvider"),
    ...require("./src/MetaMaskTruffleProvider"),
    ...require("./src/MigrationUtils"),
    ...require("./src/TruffleConfig"),
    ...require("./src/ProviderUtils"),
    ...require("./src/HardhatConfig")
  };

  module.exports = {
    ...browserSafe,
    ...browserUnsafe
  };
}
