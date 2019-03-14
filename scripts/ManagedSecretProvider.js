const HDWalletProvider = require("truffle-hdwallet-provider");
const kms = require("@google-cloud/kms");
const { readFileSync } = require("fs");
const { Storage } = require("@google-cloud/storage");

// Wraps HDWalletProvider, deferring construction and allowing a Cloud KMS managed secret to be fetched asynchronously
// and used to initialize an HDWalletProvider.
class ManagedSecretProvider {
  // cloudKmsSecretConfig must have the fields:
  //   projectId: ID of a Google Cloud project
  //   keyRingId: ID of keyring
  //   cryptoKeyId: ID of the crypto key to use for decrypting the key material
  //   locationId: Google Cloud location, e.g., 'global'.
  //   ciphertextBucket: ID of a Google Cloud storage bucket.
  //   ciphertextFilename: Name of a file within `ciphertextBucket`.
  constructor(cloudKmsSecretConfig, ...remainingArgs) {
    this.cloudKmsSecretConfig = cloudKmsSecretConfig;
    this.remainingArgs = remainingArgs;
    this.wrappedProvider = null;
    this.wrappedProviderPromise = this.getOrConstructWrappedProvider();
  }

  // Kicks off the construction of the wrapper provider. Call (and await on) this method before invoking any other
  // methods.
  async constructWrappedProvider() {
    return this.wrappedProviderPromise;
  }

  // Passes the call through, by attaching a callback to the wrapper provider promise.
  sendAsync(...all) {
    this.wrappedProviderPromise.then(wrappedProvider => {
      wrappedProvider.sendAsync(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  send(...all) {
    // The underlying call appears to always throw.
    throw "Use sendAsync instead of send";
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  getAddress(idx) {
    return getWrappedProviderOrThrow().getAddress(idx);
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  getAddress(...all) {
    return getWrappedProviderOrThrow().getAddress(...all);
  }

  // Returns the underlying wrapped provider.
  getWrappedProviderOrThrow() {
    if (this.wrappedProvider) {
      return this.wrappedProvider;
    } else {
      throw "Must init provider first, can't get value synchronously";
    }
  }

  // Returns a Promise that resolves to the wrapped provider.
  getOrConstructWrappedProvider() {
    if (this.wrappedProvider) {
      return Promise.resolve(this.wrappedProvider);
    }

    const storage = new Storage();
    const keyMaterialBucket = storage.bucket(this.cloudKmsSecretConfig.ciphertextBucket);
    const ciphertextFile = keyMaterialBucket.file(this.cloudKmsSecretConfig.ciphertextFilename);

    return ciphertextFile
      .download()
      .then(
        data => {
          // Send the request to decrypt the downloaded file.
          const contentsBuffer = data[0];
          const ciphertext = contentsBuffer.toString("base64");

          const client = new kms.KeyManagementServiceClient();
          const name = client.cryptoKeyPath(
            this.cloudKmsSecretConfig.projectId,
            this.cloudKmsSecretConfig.locationId,
            this.cloudKmsSecretConfig.keyRingId,
            this.cloudKmsSecretConfig.cryptoKeyId
          );
          return client.decrypt({ name, ciphertext });
        },
        reason => {
          console.error(reason);
        }
      )
      .then(
        ([result]) => {
          // Construct a HDWalletProvider based on mnemonic in the plaintext.
          const mnemonic = Buffer.from(result.plaintext, "base64")
            .toString()
            .trim();
          this.wrappedProvider = new HDWalletProvider(mnemonic, ...this.remainingArgs);
          return Promise.resolve(this.wrappedProvider);
        },
        reason => {
          console.error(reason);
        }
      );
  }
}

module.exports = ManagedSecretProvider;
