const HDWalletProvider = require("truffle-hdwallet-provider");
const kms = require("@google-cloud/kms");
const { readFileSync } = require("fs");

// Wraps HDWalletProvider, deferring construction and allowing a Cloud KMS managed secret to be fetched asynchronously
// and used to initialize an HDWalletProvider.
// TODO(ptare): Two features need to be added.
// 1. A way to "lock" construction to prevent multiple initializations (though Truffle will initialize your provider multiple times anyway if you use a thunk in truffle.js).
// 2. An initialization method that our scripts can call before interacting with the provider. Note that this won't prevent
// Truffle itself from interacting with the provider before it's been initialized.
class ManagedSecretProvider {
  // cloudKmsSecretConfig must have the fields:
  //   projectId: ID of a Google Cloud project
  //   keyRingId: ID of keyring
  //   cryptoKeyId: ID of the crypto key to use for decrypting the key material
  //   locationId: Google Cloud location, e.g., 'global'.
  //   ciphertextFilepath: Path to a file containing encrypted secret
  constructor(cloudKmsSecretConfig, ...remainingArgs) {
    this.cloudKmsSecretConfig = cloudKmsSecretConfig;
    this.remainingArgs = remainingArgs;
    this.wrappedProvider = null;
  }

  // Constructs the wrapped provider if needed and passes the call through.
  sendAsync(...all) {
    this.getOrConstructWrappedProvider().then(wrappedProvider => {
      wrappedProvider.sendAsync(...all);
    });
  }

  // Passes the call through. Requires that the wrapper provider has been created via, e.g., `sendAsync`.
  send(...all) {
    return getWrappedProviderOrThrow().send(...all);
  }

  // Passes the call through. Requires that the wrapper provider has been created via, e.g., `sendAsync`.
  getAddress(idx) {
    return getWrappedProviderOrThrow().getAddress(idx);
  }

  // Passes the call through. Requires that the wrapper provider has been created via, e.g., `sendAsync`.
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

    const client = new kms.KeyManagementServiceClient();
    const name = client.cryptoKeyPath(
      this.cloudKmsSecretConfig.projectId,
      this.cloudKmsSecretConfig.locationId,
      this.cloudKmsSecretConfig.keyRingId,
      this.cloudKmsSecretConfig.cryptoKeyId
    );

    const contentsBuffer = readFileSync(this.cloudKmsSecretConfig.ciphertextFilepath);
    const ciphertext = contentsBuffer.toString("base64");
    return client.decrypt({ name, ciphertext }).then(([result]) => {
      const mnemonic = Buffer.from(result.plaintext, "base64")
        .toString()
        .trim();
      this.wrappedProvider = new HDWalletProvider(mnemonic, ...this.remainingArgs);
      return Promise.resolve(this.wrappedProvider);
    });
  }
}

module.exports = ManagedSecretProvider;
