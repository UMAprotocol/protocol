import { HardhatConfig } from "hardhat/types";

import { getNodeUrl, getMnemonic } from "./ProviderUtils";
import { HRE } from "./hardhat/plugins/ExtendedWeb3";
export type { HRE };
import dotenv from "dotenv";
dotenv.config();

// This prunes the config of companion networks that don't have corresponding nodes urls.
function pruneCompanionNetworks(config: {
  networks: { [name: string]: { companionNetworks?: { [name: string]: string }; chainId?: number } };
}) {
  // Loops over all the networks and extracts the companion networks object for each.
  Object.values(config.networks).forEach(({ companionNetworks }) => {
    // If the companion networks object doesn't exist, do nothing.
    if (companionNetworks) {
      // Loop over each companion network to check if it has a provided node.
      Object.entries(companionNetworks).forEach(([key, value]) => {
        // If the companion networks declaration points to a network that doesn't exist, throw.
        if (!config.networks[value]) throw new Error(`Companion network ${value} not found`);

        // Extract the chainId from the configured companion network.
        const chainId = config.networks[value].chainId;

        // If the chainId doesn't exist, do nothing since this means the node url is probably hardcoded.
        if (!chainId) return;

        // Remove the companion network if NODE_URL_<chainId> isn't provided.
        if (!process.env[`NODE_URL_${chainId}`]) delete companionNetworks[key];
      });
    }
  });
}

export function getHardhatConfig(
  configOverrides: any,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _workingDir = "./"
): Partial<HardhatConfig> {
  const mnemonic = getMnemonic();
  require("@nomiclabs/hardhat-web3");
  require("@nomiclabs/hardhat-ethers");
  require("hardhat-deploy");
  require("hardhat-gas-reporter");
  require("./gckms/KeyInjectorPlugin");
  require("hardhat-tracer");

  // Custom tasks.
  require("./hardhat");

  // Custom plugin to enhance web3 functionality.
  require("./hardhat/plugins/ExtendedWeb3");

  // Solc version defined here so etherscan-verification has access to it.
  const solcVersion = "0.8.16";

  // Compilation settings are overridden for large contracts to allow them to compile without going over the bytecode
  // limit.
  const LARGE_CONTRACT_COMPILER_SETTINGS = {
    version: solcVersion,
    settings: { optimizer: { enabled: true, runs: 200 } },
  };

  const EXTRA_LARGE_CONTRACT_COMPILER_SETTINGS = {
    version: solcVersion,
    settings: { optimizer: { enabled: true, runs: 1 } },
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
        "contracts/data-verification-mechanism/implementation/Voting.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/data-verification-mechanism/implementation/VotingV2.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/data-verification-mechanism/implementation/test/VotingTest.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
        "contracts/data-verification-mechanism/implementation/test/VotingV2Test.sol": EXTRA_LARGE_CONTRACT_COMPILER_SETTINGS,
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
        allowUnlimitedContractSize: true,
      },
      localhost: {
        url: "http://127.0.0.1:9545",
        timeout: 1800000,
        testBlacklist,
      },
      mainnet: {
        chainId: 1,
        url: getNodeUrl("mainnet", true, 1),
        accounts: { mnemonic },
        companionNetworks: { arbitrum: "arbitrum", optimism: "optimism", boba: "boba", xdai: "xdai" },
      },
      rinkeby: { chainId: 4, url: getNodeUrl("rinkeby", true, 4), accounts: { mnemonic } },
      goerli: { chainId: 5, url: getNodeUrl("goerli", true, 5), accounts: { mnemonic } },
      "base-goerli": { chainId: 84531, url: getNodeUrl("base-goerli", true, 84531), accounts: { mnemonic } },
      kovan: { chainId: 42, url: getNodeUrl("kovan", true, 42), accounts: { mnemonic } },
      optimism: {
        chainId: 10,
        url: getNodeUrl("optimism", true, 10),
        accounts: { mnemonic },
        companionNetworks: { mainnet: "mainnet" },
      },
      "optimism-kovan": { chainId: 69, url: getNodeUrl("optimism-kovan", true, 69), accounts: { mnemonic } },
      xdai: {
        chainId: 100,
        url: getNodeUrl("xdai", true, 100),
        gas: 500000,
        gasPrice: 1000000000,
        accounts: { mnemonic },
        companionNetworks: { mainnet: "mainnet" },
      },
      matic: {
        chainId: 137,
        url: getNodeUrl("polygon-matic", true, 137),
        accounts: { mnemonic },
        gasPrice: 30000000000,
      },
      mumbai: { chainId: 80001, url: getNodeUrl("polygon-mumbai", true, 80001), accounts: { mnemonic } },
      boba: {
        chainId: 288,
        url: getNodeUrl("boba", true, 288),
        accounts: { mnemonic },
        companionNetworks: { mainnet: "mainnet" },
      },
      arbitrum: {
        chainId: 42161,
        url: getNodeUrl("arbitrum", true, 42161),
        accounts: { mnemonic },
        companionNetworks: { mainnet: "mainnet" },
      },
      "arbitrum-rinkeby": {
        chainId: 421611,
        url: getNodeUrl("arbitrum-rinkeby", true, 421611),
        accounts: { mnemonic },
      },
      sx: {
        chainId: 416,
        url: getNodeUrl("sx", true, 416),
        accounts: { mnemonic },
        companionNetworks: { mainnet: "matic" },
      },
      avalanche: {
        chainId: 43114,
        url: getNodeUrl("avalanche", true, 416),
        accounts: { mnemonic },
      },
      evmos: {
        chainId: 9001,
        url: getNodeUrl("evmos", true, 9001),
        accounts: { mnemonic },
      },
      meter: {
        chainId: 82,
        url: getNodeUrl("meter", true, 82),
        accounts: { mnemonic },
      },
    },
    mocha: { timeout: 1800000 },
    etherscan: {
      // Your API key for Etherscan
      // Obtain one at https://etherscan.io/
      apiKey: process.env.ETHERSCAN_API_KEY,
      customChains: [
        {
          network: "boba",
          chainId: 288,
          urls: {
            apiURL: "https://api.bobascan.com/api",
            browserURL: "https://bobascan.com",
          },
        },
        {
          network: "base-goerli",
          chainId: 84531,
          urls: {
            apiURL: "https://api-goerli.basescan.org/api",
            browserURL: "https://goerli.basescan.org",
          },
        },
      ],
    },
    namedAccounts: { deployer: 0 },
  } as unknown) as HardhatConfig; // Cast to allow extra properties.

  // Prune any companion networks that don't have the correct env variables.
  pruneCompanionNetworks(defaultConfig);

  // To allow customizing the chain id when forking, allow the user to provide an env variable.
  if (process.env.HARDHAT_CHAIN_ID) defaultConfig.networks.hardhat.chainId = parseInt(process.env.HARDHAT_CHAIN_ID);

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
