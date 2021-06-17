const kms = require("@google-cloud/kms");
const { Storage } = require("@google-cloud/storage");
const { extendConfig } = require("hardhat/config");
const { HardhatPluginError } = require("hardhat/plugins");
const { getGckmsConfig } = require("./GckmsConfig");
const deasync = require("deasync");

const { GCKMS_KEYS, MNEMONIC } = process.env;

async function retrieveGckmsKeys(gckmsConfigs) {
  return await Promise.all(
    gckmsConfigs.map(async (config) => {
      const storage = new Storage();
      const keyMaterialBucket = storage.bucket(config.ciphertextBucket);
      const ciphertextFile = keyMaterialBucket.file(config.ciphertextFilename);

      const contentsBuffer = (await ciphertextFile.download())[0];
      const ciphertext = contentsBuffer.toString("base64");

      // Send the request to decrypt the downloaded file.
      const client = new kms.KeyManagementServiceClient();
      const name = client.cryptoKeyPath(config.projectId, config.locationId, config.keyRingId, config.cryptoKeyId);
      const [result] = await client.decrypt({ name, ciphertext });
      return Buffer.from(result.plaintext, "base64").toString().trim();
    })
  );
}

extendConfig((config, userConfig) => {
  if (GCKMS_KEYS && MNEMONIC) {
    throw new HardhatPluginError("Key Provider", "Cannot provide both GCKMS_KEYS and MNEMONIC");
  }

  if (GCKMS_KEYS) {
    const keyNameArray = GCKMS_KEYS.split(",");
    const gckmsConfigs = getGckmsConfig(keyNameArray);
    retrieveGckmsKeys(gckmsConfigs).then(keys => (config.networks.localhost.accounts = keys));
  }
});
