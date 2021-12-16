import { HardhatConfig } from "hardhat/types";

import { getNodeUrl, getMnemonic } from "./ProviderUtils";
import { HRE } from "./hardhat/plugins/ExtendedWeb3";
export type { HRE };

export function getHardhatConfig(
  configOverrides: any,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _workingDir = "./",
  includeTruffle = true
): Partial<HardhatConfig> {
  const mnemonic = getMnemonic();
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
  const solcVersion = "0.8.9";

  // Compilation settings are overridden for large contracts to allow them to compile without going over the bytecode
  // limit.
  const LARGE_CONTRACT_COMPILER_SETTINGS = {
    version: solcVersion,
    settings: { optimizer: { enabled: true, runs: 200 } },
  };

  // Some tests should not be tested using hardhat. Define all tests that end with *e2e.js to be ignored.
  const testBlacklist = [".e2e.js"];

  const defaultConfig = ({
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
        "contracts/insured-bridge/BridgePool.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
      },
    },
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
      localhost: { url: "http://127.0.0.1:9545", timeout: 1800000, testBlacklist },
      mainnet: { chainId: 1, url: getNodeUrl("mainnet", true), accounts: { mnemonic } },
      rinkeby: { chainId: 4, url: getNodeUrl("rinkeby", true), accounts: { mnemonic } },
      goerli: { chainId: 5, url: getNodeUrl("goerli", true), accounts: { mnemonic } },
      kovan: { chainId: 42, url: getNodeUrl("kovan", true), accounts: { mnemonic } },
      arbitrum: { chainId: 42161, url: getNodeUrl("arbitrum", true), accounts: { mnemonic } },
      "arbitrum-rinkeby": { chainId: 421611, url: getNodeUrl("arbitrum-rinkeby", true), accounts: { mnemonic } },
      optimism: { chainId: 10, url: getNodeUrl("optimism", true), accounts: { mnemonic } },
      "optimism-kovan": { chainId: 69, url: getNodeUrl("optimism-kovan", true), accounts: { mnemonic } },
      "optimism-test": {
        url: "http://127.0.0.1:8545",
        accounts: { mnemonic: "test test test test test test test test test test test junk" },
        // This sets the gas price to 0 for all transactions on L2. We do this because account balances are not yet
        // automatically initiated with an ETH balance.
        gasPrice: 0,
        testWhitelist: ["oracle/Finder"],
        testBlacklist,
      },
      matic: { chainId: 137, url: getNodeUrl("polygon-matic", true), accounts: { mnemonic }, gasPrice: 30000000000 },
      mumbai: { chainId: 80001, url: getNodeUrl("polygon-mumbai", true), accounts: { mnemonic } },
      boba: { chainId: 288, url: getNodeUrl("boba", true), accounts: { mnemonic } },
    },
    mocha: { timeout: 1800000 },
    etherscan: {
      // Your API key for Etherscan
      // Obtain one at https://etherscan.io/
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    namedAccounts: { deployer: 0 },
  } as unknown) as HardhatConfig; // Cast to allow extra properties.

  return { ...defaultConfig, ...configOverrides };
}

// Helper method to let the user of HardhatConfig assign a global address which is then accessible from the @uma/core
// getAddressTest method. This enables hardhat to be used in tests like the main index.js entry tests in the liquidator
// disputer and monitor bots. In future, this should be refactored to use https://github.com/wighawag/hardhat-deploy
export function addGlobalHardhatTestingAddress(contractName: string, address: string): void {
  const castedGlobal = (global as unknown) as {
    hardhatTestingAddresses: undefined | { [contractName: string]: string };
  };
  if (!castedGlobal.hardhatTestingAddresses) {
    castedGlobal.hardhatTestingAddresses = {};
  }
  castedGlobal.hardhatTestingAddresses[contractName] = address;
}
