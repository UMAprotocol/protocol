import HDWalletProvider from "@truffle/hdwallet-provider";
import { retrieveGckmsKeys } from "./utils";
import type { KeyConfig } from "./GckmsConfig";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tail2<T extends any[]> = T extends [unknown, unknown, ...infer R] ? R : never;
type RemainingHDWalletArgs = Tail2<ConstructorParameters<typeof HDWalletProvider>>;

// Wraps HDWalletProvider, deferring construction and allowing a Cloud KMS managed secret to be fetched asynchronously
// and used to initialize an HDWalletProvider.
export class ManagedSecretProvider {
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
    private readonly cloudKmsSecretConfigs: KeyConfig[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly providerOrUrl: string | any, // Mirrors the type that HDWalletProvider expects.
    ...remainingArgs: RemainingHDWalletArgs
  ) {
    if (!Array.isArray(cloudKmsSecretConfigs)) {
      cloudKmsSecretConfigs = [cloudKmsSecretConfigs];
    }
    this.remainingArgs = remainingArgs;
    this.wrappedProvider = null;
    this.wrappedProviderPromise = this.getOrConstructWrappedProvider();
  }

  // Passes the call through, by attaching a callback to the wrapper provider promise.
  sendAsync(...all: Parameters<HDWalletProvider["sendAsync"]>): ReturnType<HDWalletProvider["sendAsync"]> {
    this.wrappedProviderPromise.then((wrappedProvider) => {
      wrappedProvider.sendAsync(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  send(...all: Parameters<HDWalletProvider["send"]>): ReturnType<HDWalletProvider["send"]> {
    this.wrappedProviderPromise.then((wrappedProvider) => {
      wrappedProvider.send(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  getAddress(...all: Parameters<HDWalletProvider["getAddress"]>): ReturnType<HDWalletProvider["getAddress"]> {
    return this.getWrappedProviderOrThrow().getAddress(...all);
  }

  // Returns the underlying wrapped provider.
  getWrappedProviderOrThrow(): HDWalletProvider {
    if (this.wrappedProvider) {
      return this.wrappedProvider;
    } else {
      throw new Error("Must init provider first, can't get value synchronously");
    }
  }

  // Returns a Promise that resolves to the wrapped provider.
  async getOrConstructWrappedProvider(): Promise<HDWalletProvider> {
    if (this.wrappedProvider) {
      return this.wrappedProvider;
    }

    const keys = await retrieveGckmsKeys(this.cloudKmsSecretConfigs);
    this.wrappedProvider = new HDWalletProvider(keys, this.providerOrUrl, ...this.remainingArgs);

    return this.wrappedProvider;
  }
}
