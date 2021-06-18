const HDWalletProvider = require("@truffle/hdwallet-provider");
const { retrieveGckmsKeys } = require("./utils");

// Wraps HDWalletProvider, deferring construction and allowing a Cloud KMS managed secret to be fetched asynchronously
// and used to initialize an HDWalletProvider.
class ManagedSecretProvider {
  // cloudKmsSecretConfigs must either be:
  //   a single config object which representing a mnemonic or a private key on GCKMS
  //   or
  //   an array of configs where each config must represent a private key
  //   and each config contains the following fields:
  //     projectId: ID of a Google Cloud project
  //     keyRingId: ID of keyring
  //     cryptoKeyId: ID of the crypto key to use for decrypting the key material
  //     locationId: Google Cloud location, e.g., 'global'.
  //     ciphertextBucket: ID of a Google Cloud storage bucket.
  //     ciphertextFilename: Name of a file within `ciphertextBucket`.
  constructor(cloudKmsSecretConfigs, ...remainingArgs) {
    if (!Array.isArray(cloudKmsSecretConfigs)) {
      cloudKmsSecretConfigs = [cloudKmsSecretConfigs];
    }
    this.cloudKmsSecretConfigs = cloudKmsSecretConfigs;
    this.remainingArgs = remainingArgs;
    this.wrappedProvider = null;
    this.wrappedProviderPromise = this.getOrConstructWrappedProvider();
  }

  // Passes the call through, by attaching a callback to the wrapper provider promise.
  sendAsync(...all) {
    this.wrappedProviderPromise.then((wrappedProvider) => {
      wrappedProvider.sendAsync(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `getOrConstructWrappedProvider`.
  send(...all) {
    this.wrappedProviderPromise.then((wrappedProvider) => {
      wrappedProvider.send(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `getOrConstructWrappedProvider`.
  getAddress(...all) {
    return this.getWrappedProviderOrThrow().getAddress(...all);
  }

  // Returns the underlying wrapped provider.
  getWrappedProviderOrThrow() {
    if (this.wrappedProvider) {
      return this.wrappedProvider;
    } else {
      throw new Error("Must init provider first, can't get value synchronously");
    }
  }

  // Returns a Promise that resolves to the wrapped provider.
  async getOrConstructWrappedProvider() {
    if (this.wrappedProvider) {
      return this.wrappedProvider;
    }

    const keys = await retrieveGckmsKeys(this.cloudKmsSecretConfigs);
    this.wrappedProvider = new HDWalletProvider(keys, ...this.remainingArgs);

    return this.wrappedProvider;
  }
}

module.exports = { ManagedSecretProvider };
