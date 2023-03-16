import kms from "@google-cloud/kms";
import { Storage } from "@google-cloud/storage";
import type { KeyConfig } from "./GckmsConfig";

const { GCP_STORAGE_CONFIG } = process.env;

// Allows the environment to customize the config that's used to interact with google cloud storage.
// Relevant options can be found here: https://googleapis.dev/nodejs/storage/latest/global.html#StorageOptions.
// Specific fields of interest:
// - timeout: allows the env to set the timeout for all http requests.
// - retryOptions: object that allows the caller to specify how the library retries.
const storageConfig = GCP_STORAGE_CONFIG ? JSON.parse(GCP_STORAGE_CONFIG) : undefined;

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
export async function retrieveGckmsKeys(gckmsConfigs: KeyConfig[]): Promise<string[]> {
  return await Promise.all(
    gckmsConfigs.map(async (config) => {
      const storage = new Storage(storageConfig);
      const keyMaterialBucket = storage.bucket(config.ciphertextBucket);
      const ciphertextFile = keyMaterialBucket.file(config.ciphertextFilename);

      const contentsBuffer = (await ciphertextFile.download())[0];
      const ciphertext = contentsBuffer.toString("base64");

      // Send the request to decrypt the downloaded file.
      const client = new kms.KeyManagementServiceClient();
      const name = client.cryptoKeyPath(config.projectId, config.locationId, config.keyRingId, config.cryptoKeyId);
      const [result] = await client.decrypt({ name, ciphertext });
      if (!(result.plaintext instanceof Uint8Array)) throw new Error("result.plaintext wrong type");
      return "0x" + Buffer.from(result.plaintext).toString().trim();
    })
  );
}
