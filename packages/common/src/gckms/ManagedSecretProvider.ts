import HDWalletProvider from "@truffle/hdwallet-provider";
import kms from "@google-cloud/kms";
import { Storage } from "@google-cloud/storage";

interface CloudKmsConfig {
  projectId: string;
  locationId: string;
  keyRingId: string;
  cryptoKeyId: string;
  ciphertextBucket: string;
  ciphertextFilename: string;
}

type Tail2<T extends any[]> = T extends [unknown, unknown, ...infer R] ? R : never;
type RemainingHDWalletArgs = Tail2<ConstructorParameters<typeof HDWalletProvider>>;

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
  private readonly remainingArgs: RemainingHDWalletArgs;
  private wrappedProvider: null | HDWalletProvider;
  private wrappedProviderPromise: Promise<HDWalletProvider>;
  constructor(
    private readonly cloudKmsSecretConfigs: CloudKmsConfig[],
    private readonly providerOrUrl: string | any, // Mirrors the type that HDWalletProvider expects.
    ...remainingArgs: Tail2<ConstructorParameters<typeof HDWalletProvider>>
  ) {
    if (!Array.isArray(cloudKmsSecretConfigs)) {
      cloudKmsSecretConfigs = [cloudKmsSecretConfigs];
    }
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
  sendAsync(...all: Parameters<HDWalletProvider["sendAsync"]>) {
    this.wrappedProviderPromise.then((wrappedProvider) => {
      wrappedProvider.sendAsync(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  send(...all: Parameters<HDWalletProvider["send"]>) {
    this.wrappedProviderPromise.then((wrappedProvider) => {
      wrappedProvider.send(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  getAddress(...all: Parameters<HDWalletProvider["getAddress"]>) {
    return this.getWrappedProviderOrThrow().getAddress(...all);
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
        let keys: string[] | string = results.map(([result]) => {
          if (result.plaintext !== typeof Uint8Array) {
            throw new Error("Result formatted incorrectly");
          }
          return Buffer.from(result.plaintext, "base64").toString().trim();
        });

        // If there is only 1 key, convert into a single element before constructing `HDWalletProvider`
        // This is important, as a single mnemonic will fail if passed in as an array.
        if (keys.length == 1) {
          keys = keys[0];
        }

        this.wrappedProvider = new HDWalletProvider(keys, this.providerOrUrl, ...this.remainingArgs);

        return this.wrappedProvider;
      },
      (reason) => {
        console.error(reason);
        throw reason;
      }
    );
  }
}

module.exports = { ManagedSecretProvider };
