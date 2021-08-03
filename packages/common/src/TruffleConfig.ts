/**
 * @notice This script contains private keys, mnemonics, and API keys that serve as default values so that it executes
 * even if the user has not set up their environment variables properly. Typically, these are sensitive secrets that
 * should never be shared publicly and ideally should not be stored in plain text.
 */

import path from "path";
import Web3 from "web3";
import dotenv from "dotenv";
import minimist from "minimist";
import HDWalletProvider from "@truffle/hdwallet-provider";

import LedgerWalletProvider from "@umaprotocol/truffle-ledger-provider";
import { getGckmsConfig } from "./gckms/GckmsConfig";
import { ManagedSecretProvider } from "./gckms/ManagedSecretProvider";
import { PublicNetworks, isPublicNetwork } from "./PublicNetworks";
import { MetaMaskTruffleProvider } from "./MetaMaskTruffleProvider";

import type { AbstractProvider } from "web3-core";

dotenv.config();
const argv = minimist(process.argv.slice(), { string: ["gasPrice"] });

export interface Network {
  networkCheckTimeout?: number;
  network_id?: number | string;
  gas?: number | string;
  gasPrice?: number | string;
  provider?: ((inputProviderOrUrl?: AbstractProvider | string) => AbstractProvider) | AbstractProvider | string;
}

// Fallback to a public mnemonic to prevent exceptions.
export const mnemonic = process.env.MNEMONIC
  ? process.env.MNEMONIC
  : "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";

// Fallback to a public private key to prevent exceptions.
const privateKey = process.env.PRIVATE_KEY
  ? process.env.PRIVATE_KEY
  : "0x348ce564d427a3311b6536bbcff9390d69395b06ed6c486954e971d960fe8709";

// Fallback to a backup non-prod API key.
const keyOffset = process.env.KEY_OFFSET ? parseInt(process.env.KEY_OFFSET) : 0; // Start at account 0 by default.
const numKeys = process.env.NUM_KEYS ? parseInt(process.env.NUM_KEYS) : 2; // Generate two wallets by default.
let singletonProvider: AbstractProvider;

// Default options
const gasPx = argv.gasPrice ? Web3.utils.toWei(argv.gasPrice, "gwei").toString() : "1000000000"; // 1 gwei
const gas = undefined; // Defining this as undefined (rather than leaving undefined) forces truffle estimate gas usage.
const GckmsConfig = getGckmsConfig();

// If a custom node URL is provided, use that. Otherwise use an infura websocket connection.
export function getNodeUrl(networkName: string, useHttps = false): string {
  if (isPublicNetwork(networkName) && !networkName.includes("fork")) {
    const infuraApiKey = process.env.INFURA_API_KEY || "e34138b2db5b496ab5cc52319d2f0299";
    const name = networkName.split("_")[0];
    return (
      process.env.CUSTOM_NODE_URL ||
      (useHttps ? `https://${name}.infura.io/v3/${infuraApiKey}` : `wss://${name}.infura.io/ws/v3/${infuraApiKey}`)
    );
  }

  const port = process.env.CUSTOM_LOCAL_NODE_PORT || "9545";
  return `http://127.0.0.1:${port}`;
}

// Adds a public network.
// Note: All public networks can be accessed using keys from GCS using the ManagedSecretProvider or using a mnemonic in the
// shell environment.
function addPublicNetwork(
  networks: { [name: string]: Network },
  name: string,
  networkId: number,
  customTruffleConfig: Network
) {
  const options = {
    networkCheckTimeout: 15000,
    network_id: networkId,
    gas: customTruffleConfig?.gas || gas,
    gasPrice: customTruffleConfig?.gasPrice || gasPx,
    ...customTruffleConfig,
  };

  const nodeUrl = getNodeUrl(name);

  // GCS ManagedSecretProvider network.
  networks[name + "_gckms"] = {
    ...options,
    provider: function (provider: AbstractProvider | string = nodeUrl) {
      if (!singletonProvider) {
        singletonProvider = new ManagedSecretProvider(GckmsConfig, provider, 0, GckmsConfig.length);
      }
      return singletonProvider;
    },
  };

  // Private key network.
  networks[name + "_privatekey"] = {
    ...options,
    provider: function (provider: AbstractProvider | string = nodeUrl) {
      if (!singletonProvider) {
        singletonProvider = new HDWalletProvider([privateKey], provider);
      }
      return singletonProvider;
    },
  };

  // Mnemonic network.
  networks[name + "_mnemonic"] = {
    ...options,
    provider: function (provider: AbstractProvider | string = nodeUrl) {
      if (!singletonProvider) {
        singletonProvider = new HDWalletProvider(mnemonic, provider, keyOffset, numKeys);
      }
      return singletonProvider;
    },
  };

  const legacyLedgerOptions = { networkId: networkId, accountsLength: numKeys, accountsOffset: keyOffset };

  // Ledger has changed their standard derivation path since this library was created, so we must override the default one.
  const ledgerOptions = { ...legacyLedgerOptions, path: "44'/60'/0'/0/0" };

  // Normal ledger wallet network.
  networks[name + "_ledger"] = {
    ...options,
    provider: function (provider: AbstractProvider | string = nodeUrl) {
      if (!singletonProvider) {
        singletonProvider = new LedgerWalletProvider(ledgerOptions, provider);
      }
      return singletonProvider;
    },
  };

  // Legacy ledger wallet network.
  // Note: the default derivation path matches the "legacy" ledger account in Ledger Live.
  networks[name + "_ledger_legacy"] = {
    ...options,
    provider: function (provider: AbstractProvider | string = nodeUrl) {
      if (!singletonProvider) {
        singletonProvider = new LedgerWalletProvider(legacyLedgerOptions, provider);
      }
      return singletonProvider;
    },
  };
}

// Adds a local network.
// Note: local networks generally have more varied parameters, so the user can override any network option by passing
// a customOptions object.
function addLocalNetwork(networks: { [name: string]: Network }, name: string, customOptions?: Network) {
  const nodeUrl = getNodeUrl(name);
  const defaultOptions: Network = {
    network_id: "*",
    gas: gas,
    gasPrice: gasPx,
    provider: function (provider: string | AbstractProvider = nodeUrl): AbstractProvider {
      // Don't use the singleton here because there's no reason to for local networks.

      // Note: this is the way that truffle initializes their host + port http provider.
      // It is required to fix connection issues when testing.
      if (typeof provider === "string" && !provider.startsWith("ws")) {
        // Deprecated method abstract provider is required but unused. Force the type to be AbstractProvider.
        return (new Web3.providers.HttpProvider(provider, { keepAlive: false }) as unknown) as AbstractProvider;
      }
      const tempWeb3 = new Web3(provider);
      if (
        !tempWeb3.eth.currentProvider ||
        typeof tempWeb3.eth.currentProvider === "string" ||
        !tempWeb3.eth.currentProvider.send
      )
        throw new Error("Web3 couldn't initialize provider");
      // Similar to the above, cast to abstract provider.
      return tempWeb3.eth.currentProvider as AbstractProvider;
    },
  };

  networks[name] = { ...defaultOptions, ...customOptions };
}

const networks = {};

// Public networks that need both a mnemonic and GCS ManagedSecretProvider network.
for (const [id, { name, customTruffleConfig }] of Object.entries(PublicNetworks)) {
  addPublicNetwork(networks, name, parseInt(id), customTruffleConfig);
}

// Add test network.
addLocalNetwork(networks, "test");

// Mainnet fork is just a local network with id 1 and a hardcoded gas limit because ganache has difficulty estimating gas on forks.
// Note: this gas limit is the default ganache block gas limit.
addLocalNetwork(networks, "mainnet-fork", { network_id: 1, gas: 6721975 });
addLocalNetwork(networks, "polygon-matic-fork", { network_id: 137, gas: 6721975 });

// MetaMask truffle provider requires a longer timeout so that user has time to point web browser with metamask to localhost:3333
addLocalNetwork(networks, "metamask", {
  networkCheckTimeout: 500000,
  provider: function () {
    if (!singletonProvider) {
      singletonProvider = new MetaMaskTruffleProvider();
    }
    return singletonProvider;
  },
});

interface TruffleConfig {
  networks: { [name: string]: Network };
  plugins: string[];
  mocha?: {
    enableTimeouts?: boolean;
    before_timeout?: number;
  };
  compilers: {
    solc: {
      version: string;
      settings?: {
        optimizer?: {
          enabled: boolean;
          runs: number;
        };
      };
    };
  };
  migrations_directory?: string;
  contracts_directory?: string;
  contracts_build_directory?: string;
}

export function getTruffleConfig(truffleContextDir = "./"): TruffleConfig {
  return {
    // See <http://truffleframework.com/docs/advanced/configuration>
    // for more about customizing your Truffle configuration!
    networks: networks,
    plugins: ["solidity-coverage"],
    mocha: { enableTimeouts: false, before_timeout: 1800000 },
    compilers: { solc: { version: "0.8.4", settings: { optimizer: { enabled: true, runs: 199 } } } },
    migrations_directory: path.join(truffleContextDir, "migrations"),
    contracts_directory: path.join(truffleContextDir, "contracts"),
    contracts_build_directory: path.join(truffleContextDir, "build/contracts"),
  };
}
