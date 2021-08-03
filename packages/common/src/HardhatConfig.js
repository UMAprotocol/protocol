const { getNodeUrl, mnemonic } = require("./TruffleConfig");

// eslint-disable-next-line no-unused-vars
function getHardhatConfig(configOverrides, workingDir = "./", includeTruffle = true) {
  // Hardhat plugins. These are imported inside `getHardhatConfig` so that other packages importing this function
  // get access to the plugins as well.
  if (includeTruffle) require("@nomiclabs/hardhat-truffle5");
  require("@nomiclabs/hardhat-web3");
  require("@nomiclabs/hardhat-etherscan");
  require("@nomiclabs/hardhat-ethers");
  require("hardhat-deploy");
  require("hardhat-gas-reporter");
  require("@eth-optimism/hardhat-ovm");
  require("./gckms/KeyInjectorPlugin");

  // Custom tasks.
  require("./hardhat");

  // Custom plugin to enhance web3 functionality.
  require("./hardhat/plugins/ExtendedWeb3");

  // Solc version defined here so etherscan-verification has access to it.
  const solcVersion = "0.8.4";

  // Compilation settings are overridden for large contracts to allow them to compile without going over the bytecode
  // limit.
  const LARGE_CONTRACT_COMPILER_SETTINGS = {
    version: solcVersion,
    settings: { optimizer: { enabled: true, runs: 200 } },
  };

  // Some tests should not be tested using hardhat. Define all tests that end with *e2e.js to be ignored.
  const testBlacklist = [".e2e.js"];

  const defaultConfig = {
    solidity: {
      compilers: [
        { version: solcVersion, settings: { optimizer: { enabled: true, runs: 1000000 } } },
        { version: "0.7.6", settings: { optimizer: { enabled: true, runs: 1000000 } } },
      ],
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
    ovm: { solcVersion: "0.7.6" },
    networks: {
      hardhat: {
        hardfork: "london",
        gasPrice: "auto",
        initialBaseFeePerGas: 1_000_000_000,
        gas: 11500000,
        blockGasLimit: 15_000_000,
        timeout: 1800000,
        testBlacklist,
      },
      localhost: { url: "http://127.0.0.1:9545", testBlacklist },
      rinkeby: { chainId: 4, url: getNodeUrl("rinkeby", true), accounts: { mnemonic } },
      kovan: { chainId: 42, url: getNodeUrl("kovan", true), accounts: { mnemonic } },
      goerli: { chainId: 5, url: getNodeUrl("goerli", true), accounts: { mnemonic } },
      mumbai: { chainId: 80001, url: getNodeUrl("polygon-mumbai", true), accounts: { mnemonic } },
      matic: { chainId: 137, url: getNodeUrl("polygon-matic", true), accounts: { mnemonic } },
      mainnet: { chainId: 1, url: getNodeUrl("mainnet", true), accounts: { mnemonic } },
      optimism: {
        ovm: true,
        url: "http://127.0.0.1:8545",
        accounts: { mnemonic: "test test test test test test test test test test test junk" },
        // This sets the gas price to 0 for all transactions on L2. We do this because account balances are not yet
        // automatically initiated with an ETH balance.
        gasPrice: 0,
        // We use custom logic to only compile contracts within the listed directories, as opposed to choosing which
        // ones to ignore, because there are more contracts to ignore than to include.
        compileWhitelist: ["OVM_BridgeDepositBox", "OVM_Timer"],
        testWhitelist: ["oracle/Finder"],
        testBlacklist,
      },
    },
    mocha: { timeout: 1800000 },
    etherscan: {
      // Your API key for Etherscan
      // Obtain one at https://etherscan.io/
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    namedAccounts: { deployer: 0 },
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
