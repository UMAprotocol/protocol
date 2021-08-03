import { retrieveGckmsKeys } from "./utils";
import { extendConfig } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { getGckmsConfig } from "./GckmsConfig";

// This plugin just injects GCKMS keys into the config.
// Because it does so asynchonously, it creates a race condition. This means it may not work in all circumstances.
// It has been experimentally proven to work with hardhat console. Use with caution.
extendConfig((config) => {
  const { GCKMS_KEYS, MNEMONIC } = process.env;

  // If a mnemonic is provided as well, throw an error.
  if (GCKMS_KEYS && MNEMONIC)
    throw new HardhatPluginError("gckms::KeyInjectorPlugin", "Cannot provide both GCKMS_KEYS and MNEMONIC");

  // If GCKMS_KEYS is not found, do nothing.
  if (GCKMS_KEYS) {
    const keyNameArray = GCKMS_KEYS.split(",");
    const gckmsConfigs = getGckmsConfig(keyNameArray);
    retrieveGckmsKeys(gckmsConfigs).then((keys) => {
      Object.values(config.networks).forEach((network) => {
        network.accounts = keys;
      });
    });
  }
});
