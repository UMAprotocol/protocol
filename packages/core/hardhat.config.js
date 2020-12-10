const chalkPipe = require("chalk-pipe");
const { task } = require("hardhat/config");

require("@nomiclabs/hardhat-truffle5");
require("solidity-coverage");
require("@nomiclabs/hardhat-etherscan");
//usePlugin("hardhat-gas-reporter");

task("test")
  .addFlag("debug", "Compile without optimizer")
  .setAction(async (taskArgs, bre, runSuper) => {
    const { debug } = taskArgs;

    if (debug) {
      // Optmizer config changes.
      bre.config.solc.optimizer.enabled = false;

      // Network config changes
      bre.config.networks.hardhat.allowUnlimitedContractSize = true;
      bre.config.networks.hardhat.blockGasLimit = 0x1fffffffffffff;
      bre.config.networks.hardhat.gas = 12000000;

      console.log(chalkPipe("bold.underline")("Running tests in debug mode"));
    }

    await runSuper(taskArgs);
  });

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
    },
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  },
  mocha: {
    timeout: 1800000
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_API_KEY
  }
};
