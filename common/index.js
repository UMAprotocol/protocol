const browserSafe = {
  ...require("./AbiUtils"),
  ...require("./AdminUtils"),
  ...require("./Constants"),
  ...require("./ContractUtils"),
  ...require("./Crypto"),
  ...require("./EmpUtils"),
  ...require("./EncryptionHelper"),
  ...require("./Enums"),
  ...require("./FormattingUtils"),
  ...require("./ObjectUtils"),
  ...require("./PublicNetworks"),
  ...require("./Random"),
  ...require("./SolcoverConfig"),
  ...require("./SolidityTestUtils"),
  ...require("./TimeUtils"),
  ...require("./VotingUtils")
};

// Note: there are some webpack performance downsides to stripping the module this way, but for now it's more readable
// to keep it all in one file. This check is currently done for safety rather than performance.
if (process.browser) {
  module.exports = browserSafe;
} else {
  // Note: these need to be declared inside the else so webpack will ignore.
  const browserUnsafe = {
    ...require("./gckms/ManagedSecretProvider"),
    ...require("./MetaMaskTruffleProvider"),
    ...require("./MigrationUtils"),
    ...require("./TruffleConfig")
  };

  module.exports = {
    ...browserSafe,
    ...browserUnsafe
  };
}
