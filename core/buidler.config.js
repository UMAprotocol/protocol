const chalkPipe = require("chalk-pipe");
const { usePlugin, task } = require("@nomiclabs/buidler/config");

usePlugin("@nomiclabs/buidler-truffle5");
usePlugin("solidity-coverage");

task("test")
  .addFlag("debug", "Compile without optimizer")
  .setAction(async (taskArgs, bre, runSuper) => {
    const { debug } = taskArgs;

    if (debug) {
      bre.config.solc.optimizer.enabled = false;
      console.log(chalkPipe("bold.underline")("Running tests in debug mode"));
    }

    await runSuper(taskArgs);
  });

module.exports = {
  solc: {
    version: "0.6.6",
    optimizer: {
      enabled: true,
      runs: 200
    }
  },
  networks: {
    buidlerevm: {
      gas: 12000000,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
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
