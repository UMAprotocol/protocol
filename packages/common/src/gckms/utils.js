const kms = require("@google-cloud/kms");
const { Storage } = require("@google-cloud/storage");

// This function takes an array of GCKMS configs that are shaped as follows:
// {
//   projectId: "project-name",
//   locationId: "asia-east2",
//   keyRingId: "Keyring_Test",
//   cryptoKeyId: "keyname",
//   ciphertextBucket: "cipher_bucket",
//   ciphertextFilename: "ciphertext_fname.enc",
// }
//
// It returns an array of private keys that can be used to send transactions.
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
      return "0x" + Buffer.from(result.plaintext, "base64").toString().trim();
    })
  );
}

module.exports = { retrieveGckmsKeys };
