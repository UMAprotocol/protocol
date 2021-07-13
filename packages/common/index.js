const browserSafe = { ...require("./browser.js") };

const browserUnsafe = {
  ...require("./src/gckms/ManagedSecretProvider"),
  ...require("./src/MetaMaskTruffleProvider"),
  ...require("./src/MigrationUtils"),
  ...require("./src/TruffleConfig"),
  ...require("./src/ProviderUtils"),
  ...require("./src/HardhatConfig"),
  ...require("./src/RetryProvider"),
  ...require("./src/UniswapV3Helpers"),
};

module.exports = { ...browserSafe, ...browserUnsafe };
