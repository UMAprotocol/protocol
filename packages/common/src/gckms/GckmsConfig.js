// Example usage:
// $(npm bin)/truffle exec <some_script> --network test --keys priceFeed --keys registry

const argv = require("minimist")(process.argv.slice());
const fs = require("fs");
require("dotenv").config();

// Grab the name property from each to get a list of the names of the public networks.
const publicNetworkNames = Object.values(require("../PublicNetworks.js").PublicNetworks).map(elt => elt.name);
const { isPublicNetwork } = require("../MigrationUtils.js");

let configOverride = {};

// If there is no env variable providing the config, attempt to pull it from a file.
// TODO: this is kinda hacky. We should refactor this to only take in the config using one method.
if (process.env.GCKMS_CONFIG) {
  // If the env variable is present, just take that json.
  configOverride = JSON.parse(process.env.GCKMS_CONFIG);
} else {
  // Import the .GckmsOverride.js file if it exists.
  // Note: this file is expected to be present in the same directory as this script.
  let overrideFname = ".GckmsOverride.js";
  try {
    if (fs.existsSync(`${__dirname}/${overrideFname}`)) {
      configOverride = require(`./${overrideFname}`);
    }
  } catch (err) {
    console.error(err);
  }
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

  const defaultConfig = {
    private: {
      deployer: {},
      registry: {},
      store: {},
      priceFeed: {},
      sponsorWhitelist: {},
      returnCalculatorWhitelist: {},
      marginCurrencyWhitelist: {},
      // This is an example to show you what a typical config for a gcloud-stored config might look like.
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

  // Add a blank network config for all public networks so they don't fail to process but will fail if selected.
  const blankNetworkConfig = {
    deployer: {},
    registry: {},
    store: {},
    priceFeed: {},
    sponsorWhitelist: {},
    returnCalculatorWhitelist: {},
    marginCurrencyWhitelist: {}
  };

  for (let name of publicNetworkNames) {
    defaultConfig[name] = blankNetworkConfig;
  }

  return defaultConfig;
}

function getNetworkName() {
  if (isPublicNetwork(argv.network || "")) {
    // Take everything before the underscore:
    // mainnet_gckms -> mainnet.
    return argv.network.split("_")[0];
  }

  return "private";
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
module.exports = { GckmsConfig: keyConfigs };
