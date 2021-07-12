// Example usage:
// $(npm bin)/truffle exec <some_script> --network test --keys priceFeed --keys registry
import minimist from "minimist";
import fs from "fs";
import dotenv from "dotenv";

const argv = minimist(process.argv.slice());
dotenv.config();

// Grab the name property from each to get a list of the names of the public networks.
const publicNetworkNames = Object.values(require("../PublicNetworks.js").PublicNetworks).map((elt) => elt.name);
const { isPublicNetwork } = require("../MigrationUtils.js");

// The anatomy of an individual config is:
//   projectId: ID of a Google Cloud project
//   keyRingId: ID of keyring
//   cryptoKeyId: ID of the crypto key to use for decrypting the key material
//   locationId: Google Cloud location, e.g., 'global'.
//   ciphertextBucket: ID of a Google Cloud storage bucket.
//   ciphertextFilename: Name of a file within `ciphertextBucket`.
interface GckmsConfig {
  [network: string]: {
    [keyName: string]: {
      projectId: string;
      locationId: string;
      keyRingId: string;
      cryptoKeyId: string;
      ciphertextBucket: string;
      ciphertextFilename: string;
    };
  };
}

function arrayify<Type>(input: Type[] | Type | undefined): Type[] {
  if (!input) return [];
  if (!Array.isArray(input)) return [input];
  return input;
}

function getGckmsConfig(keys = arrayify(argv.keys), network = argv.network) {
  let configOverride = {};

  // If there is no env variable providing the config, attempt to pull it from a file.
  // TODO: this is kinda hacky. We should refactor this to only take in the config using one method.
  if (process.env.GCKMS_CONFIG) {
    // If the env variable is present, just take that json.
    configOverride = JSON.parse(process.env.GCKMS_CONFIG);
  } else {
    // Import the .GckmsOverride.js file if it exists.
    // Note: this file is expected to be present in the same directory as this script.
    const overrideFname = ".GckmsOverride.js";
    try {
      if (fs.existsSync(`${__dirname}/${overrideFname}`)) {
        configOverride = require(`./${overrideFname}`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const getNetworkName = () => {
    if (isPublicNetwork(network || "")) {
      // Take everything before the underscore:
      // mainnet_gckms -> mainnet.
      return network.split("_")[0];
    }

    return "mainnet";
  };

  // Compose the exact config for this network.
  const networkConfig = configOverride[getNetworkName()];

  // Provide the configs for the keys requested.
  const keyConfigs = keys.map((keyName) => {
    return networkConfig[keyName] || {};
  });

  return keyConfigs;
}

// Export the requested config.
module.exports = { getGckmsConfig };
