require("@nomiclabs/hardhat-truffle5");
const path = require("path");
const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));
const liquidatorWkdir = path.dirname(require.resolve("@uma/liquidator/package.json"));
module.exports = {
  solidity: {
    version: "0.6.12",
    settings: {
      optimizer: {
        enabled: true,
        runs: 199
      }
    }
  },
  networks: {
    hardhat: {
      gas: 11500000,
      blockGasLimit: 11500000,
      allowUnlimitedContractSize: false,
      timeout: 1800000
    }
  },
  paths: {
    root: coreWkdir,
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
    tests: `${liquidatorWkdir}/test`
  }
};
