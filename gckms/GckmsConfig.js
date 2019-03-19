// Example usage:
// $(npm bin)/truffle exec <some_script> --network test --keys priceFeed --keys registry

const argv = require("minimist")(process.argv.slice());
const fs = require("fs");

// Import the .GckmsOverride.js file if it exists.
// Note: this file is expected to be present in the same directory as this script.
let overrideFname = ".GckmsOverride.js";
let configOverride = {};
try {
  if (fs.existsSync(`${__dirname}/${overrideFname}`)) {
    configOverride = require(`./${overrideFname}`);
  }
} catch (err) {
  console.error(err);
}

// Note: this default config should not be used - it is intended to communicate the structure of the config.
// .gcloudKmsOverride.js should export your real config.
function getDefaultStaticConfig() {
  // The anatomy of an individual config is:
  //   projectId: ID of a Google Cloud project
  //   keyRingId: ID of keyring
  //   cryptoKeyId: ID of the crypto key to use for decrypting the key material
  //   locationId: Google Cloud location, e.g., 'global'.
  //   ciphertextBucket: ID of a Google Cloud storage bucket.
  //   ciphertextFilename: Name of a file within `ciphertextBucket`.
  return {
    main: {
      deployer: {},
      registry: {},
      store: {},
      priceFeed: {},
      sponsorWhitelist: {},
      returnCalculatorWhitelist: {},
      marginCurrencyWhitelist: {}
    },
    ropsten: {
      deployer: {},
      registry: {},
      store: {},
      priceFeed: {},
      sponsorWhitelist: {},
      returnCalculatorWhitelist: {},
      marginCurrencyWhitelist: {}
    },
    private: {
      deployer: {},
      registry: {},
      store: {},
      priceFeed: {},
      sponsorWhitelist: {},
      returnCalculatorWhitelist: {},
      marginCurrencyWhitelist: {},
      example: {
        projectId: "project-name",
        locationId: "asia-east2",
        keyRingId: "Keyring_Test",
        cryptoKeyId: "keyname",
        ciphertextBucket: "cipher_bucket",
        ciphertextFilename: "ciphertext_fname.enc"
      }
    }
  };
}

function getNetworkName() {
  switch (argv.network) {
    case "mainnet":
      return "main";
    case "ropsten":
      return "ropsten";
    default:
      return "private";
  }
}

// Compose the exact config for this network.
const staticConfig = { ...getDefaultStaticConfig(), ...configOverride };
const networkConfig = staticConfig[getNetworkName()];

// Provide the configs for the keys requested.
let keys = argv.keys;
if (!keys) {
  // If no keys were provided, send an empty array.
  keys = [];
} else if (!Array.isArray(keys)) {
  // If a single key was provided, package it into an array.
  keys = [keys];
}
const keyConfigs = keys.map(keyName => {
  return networkConfig[keyName];
});

// Export the requested config.
module.exports = keyConfigs;
