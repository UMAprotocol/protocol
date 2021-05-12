const { getNodeUrl, mnemonic } = require("./TruffleConfig");

function getHardhatConfig(configOverrides) {
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
      },
      rinkeby: {
        url: getNodeUrl("rinkeby", true),
        accounts: { mnemonic }
      },
      goerli: {
        url: getNodeUrl("goerli", true),
        accounts: { mnemonic }
      },
      mumbai: {
        url: "https://rpc-mumbai.maticvigil.com/",
        accounts: { mnemonic }
      }
    },
    mocha: {
      timeout: 1800000
    },
    etherscan: {
      // Your API key for Etherscan
      // Obtain one at https://etherscan.io/
      apiKey: process.env.ETHERSCAN_API_KEY
    },
    namedAccounts: {
      deployer: 0
    }
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
module.exports = {
  getHardhatConfig,
  addGlobalHardhatTestingAddress
};
