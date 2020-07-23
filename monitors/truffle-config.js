const path = require("path");
const wkdir = path.dirname(require.resolve("@umaprotocol/core/package.json"));

module.exports = {
  ...require("@umaprotocol/common").TruffleConfig,
  migrations_directory: path.join(wkdir, "migrations"),
  contracts_directory: path.join(wkdir, "contracts"),
  contracts_build_directory: path.join(wkdir, "build/contracts")
};
