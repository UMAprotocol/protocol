const { getNodeUrl, mnemonic } = require("./TruffleConfig");
const path = require("path");

function getHardhatConfig(configOverrides, workingDir = "./", includeTruffle = true) {
  // Hardhat plugins. These are imported inside `getHardhatConfig` so that other packages importing this function
  // get access to the plugins as well.
  if (includeTruffle) require("@nomiclabs/hardhat-truffle5");
  require("hardhat-gas-reporter");
  require("@nomiclabs/hardhat-web3");
  require("hardhat-deploy");
  require("@nomiclabs/hardhat-etherscan");
  require("./gckms/KeyInjectorPlugin");

  // Custom tasks to interact conveniently with smart contracts.
  require("./hardhat/tasks");

  // Custom plugin to enhance web3 functionality.
  require("./hardhat/plugins/ExtendedWeb3");

  // Solc version defined here so etherscan-verification has access to it
  const solcVersion = "0.8.4";

  // Compilation settings are overridden for large contracts to allow them to compile without going over the bytecode
  // limit.
  const LARGE_CONTRACT_COMPILER_SETTINGS = {
    version: solcVersion,
    settings: { optimizer: { enabled: true, runs: 200 } },
  };

  const defaultConfig = {
    solidity: {
      compilers: [{ version: solcVersion, settings: { optimizer: { enabled: true, runs: 1000000 } } }],
      overrides: {
        "contracts/financial-templates/expiring-multiparty/ExpiringMultiParty.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/financial-templates/expiring-multiparty/ExpiringMultiPartyLib.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/financial-templates/perpetual-multiparty/Perpetual.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/financial-templates/perpetual-multiparty/PerpetualLib.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/financial-templates/perpetual-multiparty/PerpetualLiquidatable.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/financial-templates/expiring-multiparty/Liquidatable.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/oracle/implementation/Voting.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/oracle/implementation/test/VotingTest.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
      },
    },
    networks: {
      hardhat: { gas: 11500000, blockGasLimit: 11500000, allowUnlimitedContractSize: false, timeout: 1800000 },
      localhost: { url: "http://127.0.0.1:8545" },
      rinkeby: { chainId: 4, url: getNodeUrl("rinkeby", true), accounts: { mnemonic } },
      kovan: { chainId: 42, url: getNodeUrl("kovan", true), accounts: { mnemonic } },
      goerli: { chainId: 5, url: getNodeUrl("goerli", true), accounts: { mnemonic } },
      mumbai: { chainId: 80001, url: getNodeUrl("polygon-mumbai", true), accounts: { mnemonic } },
      matic: { chainId: 137, url: getNodeUrl("polygon-matic", true), accounts: { mnemonic } },
      mainnet: { chainId: 1, url: getNodeUrl("mainnet", true), accounts: { mnemonic } },
    },
    mocha: { timeout: 1800000 },
    etherscan: {
      // Your API key for Etherscan
      // Obtain one at https://etherscan.io/
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    namedAccounts: { deployer: 0 },
    external: {
      deployments: {
        mainnet: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/mainnet")],
        mumbai: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/mumbai")],
        matic: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/matic")],
        rinkeby: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/rinkeby")],
        kovan: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/kovan")],
        goerli: [path.join(workingDir, "build/contracts"), path.join(workingDir, "deployments/goerli")],
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
