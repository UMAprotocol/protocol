function getHardhatConfig(configOverrides) {
  require("solidity-coverage");
  require("@nomiclabs/hardhat-truffle5");
  require("@nomiclabs/hardhat-etherscan");
  require("hardhat-gas-reporter");
  require("@nomiclabs/hardhat-web3");

  // Solc version defined here so etherscan-verification has access to it
  const solcVersion = "0.6.12";
  console.log("GETTING");
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
  return { ...defaultConfig, ...configOverrides };
}
module.exports = {
  getHardhatConfig
};
