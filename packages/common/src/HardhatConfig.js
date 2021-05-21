const { getNodeUrl, mnemonic } = require("./TruffleConfig");
const path = require("path");

function getHardhatConfig(configOverrides, workingDir = "./") {
  // Hard hat plugins. These are imported inside `getHardhatConfig` so that other packages importing this function
  // get access to the plugins as well.
  require("@nomiclabs/hardhat-truffle5");
  require("hardhat-gas-reporter");
  require("@nomiclabs/hardhat-web3");
  require("hardhat-deploy");

  // Custom tasks to interact conveniently with smart contracts.
  require("./hardhat/tasks");

  // Solc version defined here so etherscan-verification has access to it
  const solcVersion = "0.8.4";

  const defaultConfig = {
    solidity: {
      version: solcVersion,
      settings: {
        optimizer: {
          enabled: true,
          runs: 199,
        },
      },
    },
    networks: {
      hardhat: {
        gas: 11500000,
        blockGasLimit: 11500000,
        allowUnlimitedContractSize: false,
        timeout: 1800000,
      },
      localhost: {
        url: "http://127.0.0.1:8545",
      },
      rinkeby: {
        chainId: 4,
        url: getNodeUrl("rinkeby", true),
        accounts: { mnemonic },
      },
      goerli: {
        chainId: 5,
        url: getNodeUrl("goerli", true),
        accounts: { mnemonic },
      },
      mumbai: {
        chainId: 80001,
        url: getNodeUrl("polygon-mumbai", true),
        accounts: { mnemonic },
      },
      matic: {
        chainId: 137,
        url: getNodeUrl("polygon-matic", true),
        accounts: { mnemonic },
      },
      mainnet: {
        chainId: 1,
        url: getNodeUrl("mainnet", true),
        accounts: { mnemonic },
      },
    },
    mocha: {
      timeout: 1800000,
    },
    etherscan: {
      // Your API key for Etherscan
      // Obtain one at https://etherscan.io/
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    namedAccounts: {
      deployer: 0,
    },
    external: {
      deployments: {
        mainnet: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/mainnet")],
        mumbai: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/mumbai")],
        matic: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/matic")],
        rinkeby: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/rinkeby")],
      },
    },
  };
  return { ...defaultConfig, ...configOverrides };
}

// Helper method to let the user of HardhatConfig assign a global address which is then accessible from the @uma/core
// getAddressTest method. This enables hardhat to be used in tests like the main index.js entry tests in the liquidator
// disputer and monitor bots. In future, this should be refactored to use https://github.com/wighawag/hardhat-deploy
function addGlobalHardhatTestingAddress(contractName, address) {
  if (!global.hardhatTestingAddresses) {
    global.hardhatTestingAddresses = {};
  }
  global.hardhatTestingAddresses[contractName] = address;
}
module.exports = { getHardhatConfig, addGlobalHardhatTestingAddress };
