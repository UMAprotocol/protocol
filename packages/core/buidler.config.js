const chalkPipe = require("chalk-pipe");
const { usePlugin, task } = require("@nomiclabs/buidler/config");

usePlugin("@nomiclabs/buidler-truffle5");
usePlugin("solidity-coverage");

task("test")
  .addFlag("debug", "Compile without optimizer")
  .setAction(async (taskArgs, bre, runSuper) => {
    const { debug } = taskArgs;

    if (debug) {
      // Optmizer config changes.
      bre.config.solc.optimizer.enabled = false;

      // Network config changes
      bre.config.networks.buidlerevm.allowUnlimitedContractSize = true;
      bre.config.networks.buidlerevm.blockGasLimit = 0x1fffffffffffff;
      bre.config.networks.buidlerevm.gas = 12000000;

      console.log(chalkPipe("bold.underline")("Running tests in debug mode"));
    }

    await runSuper(taskArgs);
  });

module.exports = {
  solc: {
    version: "0.6.12",
    optimizer: {
      enabled: true,
      runs: 199
    }
  },
  networks: {
    buidlerevm: {
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
  }
};
