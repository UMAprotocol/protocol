/**
 * @notice This script contains private keys, mnemonics, and API keys that serve as default values so that it executes
 * even if the user has not set up their environment variables properly. Typically, these are sensitive secrets that
 * should never be shared publicly and ideally should not be stored in plain text.
 */

const path = require("path");

const HDWalletProvider = require("@truffle/hdwallet-provider");
const LedgerWalletProvider = require("@umaprotocol/truffle-ledger-provider");
const { getGckmsConfig } = require("./gckms/GckmsConfig.js");
const { ManagedSecretProvider } = require("./gckms/ManagedSecretProvider.js");
const { PublicNetworks } = require("./PublicNetworks.js");
const { MetaMaskTruffleProvider } = require("./MetaMaskTruffleProvider.js");
const { isPublicNetwork } = require("./MigrationUtils");
const Web3 = require("web3");
require("dotenv").config();
const argv = require("minimist")(process.argv.slice(), { string: ["gasPrice"] });

// Fallback to a public mnemonic to prevent exceptions.
const mnemonic = process.env.MNEMONIC
  ? process.env.MNEMONIC
  : "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";

// Fallback to a public private key to prevent exceptions.
const privateKey = process.env.PRIVATE_KEY
  ? process.env.PRIVATE_KEY
  : "0x348ce564d427a3311b6536bbcff9390d69395b06ed6c486954e971d960fe8709";

// Fallback to a backup non-prod API key.
const keyOffset = process.env.KEY_OFFSET ? parseInt(process.env.KEY_OFFSET) : 0; // Start at account 0 by default.
const numKeys = process.env.NUM_KEYS ? parseInt(process.env.NUM_KEYS) : 2; // Generate two wallets by default.
let singletonProvider;

// Default options
const gasPx = argv.gasPrice ? Web3.utils.toWei(argv.gasPrice, "gwei") : 1000000000; // 1 gwei
const gas = undefined; // Defining this as undefined (rather than leaving undefined) forces truffle estimate gas usage.
const GckmsConfig = getGckmsConfig();

// If a custom node URL is provided, use that. Otherwise use an infura websocket connection.
function getNodeUrl(networkName, useHttps = false) {
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
function addPublicNetwork(networks, name, networkId, customTruffleConfig) {
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
    provider: function (provider = nodeUrl) {
      if (!singletonProvider) {
        singletonProvider = new ManagedSecretProvider(GckmsConfig, provider, 0, GckmsConfig.length);
      }
      return singletonProvider;
    },
  };

  // Private key network.
  networks[name + "_privatekey"] = {
    ...options,
    provider: function (provider = nodeUrl) {
      if (!singletonProvider) {
        singletonProvider = new HDWalletProvider([privateKey], provider);
      }
      return singletonProvider;
    },
  };

  // Mnemonic network.
  networks[name + "_mnemonic"] = {
    ...options,
    provider: function (provider = nodeUrl) {
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
    provider: function (provider = nodeUrl) {
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
    provider: function (provider = nodeUrl) {
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
function addLocalNetwork(networks, name, customOptions) {
  const nodeUrl = getNodeUrl(name);
  const defaultOptions = {
    network_id: "*",
    gas: gas,
    gasPrice: gasPx,
    provider: function (provider = nodeUrl) {
      // Don't use the singleton here because there's no reason to for local networks.

      // Note: this is the way that truffle initializes their host + port http provider.
      // It is required to fix connection issues when testing.
      if (typeof provider === "string" && !provider.startsWith("ws")) {
        return new Web3.providers.HttpProvider(provider, { keepAlive: false });
      }
      const tempWeb3 = new Web3(provider);
      return tempWeb3.eth.currentProvider;
    },
  };

  networks[name] = { ...defaultOptions, ...customOptions };
}

let networks = {};

// Public networks that need both a mnemonic and GCS ManagedSecretProvider network.
for (const [id, { name, customTruffleConfig }] of Object.entries(PublicNetworks)) {
  addPublicNetwork(networks, name, id, customTruffleConfig);
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

function getTruffleConfig(truffleContextDir = "./") {
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

module.exports = { getTruffleConfig, getNodeUrl, mnemonic };
