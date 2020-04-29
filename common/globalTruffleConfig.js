const HDWalletProvider = require("@truffle/hdwallet-provider");
const GckmsConfig = require("./gckms/GckmsConfig.js");
const ManagedSecretProvider = require("./gckms/ManagedSecretProvider.js");
const publicNetworks = require("./PublicNetworks.js");
const LedgerWalletProvider = require("@umaprotocol/truffle-ledger-provider");
const MetaMaskTruffleProvider = require("./MetaMaskTruffleProvider.js");
require("dotenv").config();

// Fallback to a public mnemonic to prevent exceptions
const mnemonic = process.env.MNEMONIC
  ? process.env.MNEMONIC
  : "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";

// Fallback to a public private key to prevent exceptions
const privateKey = process.env.PRIVATE_KEY
  ? process.env.PRIVATE_KEY
  : "0x348ce564d427a3311b6536bbcff9390d69395b06ed6c486954e971d960fe8709";

// Fallback to a backup non-prod API key.
const infuraApiKey = process.env.INFURA_API_KEY ? process.env.INFURA_API_KEY : "9317010b1b6343558b7eff9d25934f38";

// Default options
const gasPx = 20000000000; // 20 gwei
const gas = 6720000; // Conservative estimate of the block gas limit.

// Adds a public network.
// Note: All public networks can be accessed using keys from GCS using the ManagedSecretProvider or using a mnemonic in the
// shell environment.
function addPublicNetwork(networks, name, networkId) {
  const options = {
    network_id: networkId,
    gas: gas,
    gasPrice: gasPx
  };

  // GCS ManagedSecretProvider network.
  networks[name] = {
    ...options,
    provider: new ManagedSecretProvider(
      GckmsConfig,
      `https://${name}.infura.io/v3/${infuraApiKey}`,
      0,
      GckmsConfig.length
    )
  };

  // Private key network.
  networks[name + "_privatekey"] = {
    ...options,
    provider: new HDWalletProvider([privateKey], `https://${name}.infura.io/v3/${infuraApiKey}`)
  };

  // Mnemonic network.
  networks[name + "_mnemonic"] = {
    ...options,
    provider: new HDWalletProvider(mnemonic, `https://${name}.infura.io/v3/${infuraApiKey}`, 0, 2)
  };

  // Ledger has changed their standard derivation path since this library was created, so we must override the default one.
  const ledgerOptions = {
    networkId: networkId,
    path: "44'/60'/0'/0/0"
  };

  // Normal ledger wallet network.
  networks[name + "_ledger"] = {
    ...options,
    provider: new LedgerWalletProvider(ledgerOptions, `https://${name}.infura.io/v3/${infuraApiKey}`)
  };

  // The default derivation path matches the "legacy" ledger account in Ledger Live.
  const legacyLedgerOptions = {
    networkId: networkId
  };

  // Legacy ledger wallet network.
  networks[name + "_ledger_legacy"] = {
    ...options,
    provider: new LedgerWalletProvider(legacyLedgerOptions, `https://${name}.infura.io/v3/${infuraApiKey}`)
  };
}

// Adds a local network.
// Note: local networks generally have more varied parameters, so the user can override any network option by passing
// a customOptions object.
function addLocalNetwork(networks, name, customOptions) {
  const defaultOptions = {
    host: "127.0.0.1",
    network_id: "*",
    port: 9545,
    gas: gas
  };

  networks[name] = {
    ...defaultOptions,
    ...customOptions
  };

  // Override custom options if environment variables are found
  if ("LOCALHOST" in process.env) {
    networks[name].host = process.env.LOCALHOST;
  }

  if ("LOCALPORT" in process.env) {
    networks[name].port = process.env.LOCALPORT;
  }
}

let networks = {};

// Public networks that need both a mnemonic and GCS ManagedSecretProvider network.
for (const [id, { name }] of Object.entries(publicNetworks)) {
  addPublicNetwork(networks, name, id);
}

// CI requires a specific port and network ID because of peculiarities of the environment.
addLocalNetwork(networks, "ci", { port: 8545, network_id: 1234 });

// Develop and test networks are exactly the same and both use the default local parameters.
addLocalNetwork(networks, "develop");
addLocalNetwork(networks, "test");

// Coverage requires specific parameters to allow very high cost transactions.
addLocalNetwork(networks, "coverage", { port: 8545, network_id: 1234 });

// MetaMask truffle provider requires a longer timeout so that user has time to point web browser with metamask to localhost:3333
addLocalNetwork(networks, "metamask", { provider: new MetaMaskTruffleProvider(), networkCheckTimeout: 500000 });

addLocalNetwork(networks, "mainnet-fork", { port: 8545, network_id: 1 });

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // for more about customizing your Truffle configuration!
  networks: networks,
  plugins: ["solidity-coverage"],
  mocha: {
    enableTimeouts: false,
    before_timeout: 1800000
  },
  compilers: {
    solc: {
      version: "0.6.6",
      settings: {
        optimizer: {
          enabled: true,
          runs: 500
        }
      }
    }
  }
};
