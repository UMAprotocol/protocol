const kms = require("@google-cloud/kms");
const { Storage } = require("@google-cloud/storage");
const { extendConfig } = require("hardhat/config");
const { HardhatPluginError } = require("hardhat/plugins");
const { getGckmsConfig } = require("./GckmsConfig");

const { GCKMS_KEYS, MNEMONIC } = process.env;

extendConfig((config, userConfig) => {
  if (GCKMS_KEYS && MNEMONIC) {
    throw new HardhatPluginError("Key Provider", "Cannot provide both GCKMS_KEYS and MNEMONIC");
  }

  
  if (GCKMS_KEYS) {
    const { GckmsConfig } = require("./GckmsConfig");
    const keyNameArray = GCKMS_KEYS.split(",");
    const gckmsConfigs = getGckmsConfig(keyNameArray);
    gckmsConfigs.map((config) => {

    });
  } else if (MNEMONIC) {
  }
});

async function createEthersManagedSecretProvider(cloudKmsSecretConfigs, ...remainingArgs) {
  if (!Array.isArray(cloudKmsSecretConfigs)) {
    cloudKmsSecretConfigs = [cloudKmsSecretConfigs];
  }

  const fetchKeys = this.cloudKmsSecretConfigs.map((config) => {
    const storage = new Storage();
    const keyMaterialBucket = storage.bucket(config.ciphertextBucket);
    const ciphertextFile = keyMaterialBucket.file(config.ciphertextFilename);

    return ciphertextFile.download().then((data) => {
      // Send the request to decrypt the downloaded file.
      const contentsBuffer = data[0];
      const ciphertext = contentsBuffer.toString("base64");

      const client = new kms.KeyManagementServiceClient();
      const name = client.cryptoKeyPath(config.projectId, config.locationId, config.keyRingId, config.cryptoKeyId);
      return client.decrypt({ name, ciphertext });
    });
  });

  return Promise.all(fetchKeys).then(
    (results) => {
      let keys = results.map(([result]) => {
        return Buffer.from(result.plaintext, "base64").toString().trim();
      });

      // If there is only 1 key, convert into a single element before constructing `HDWalletProvider`
      // This is important, as a single mnemonic will fail if passed in as an array.
      if (keys.length == 1) {
        keys = keys[0];
      }

      this.wrappedProvider = new HDWalletProvider(keys, ...this.remainingArgs);

      return this.wrappedProvider;
    },
    (reason) => {
      console.error(reason);
      throw reason;
    }
  );
}
