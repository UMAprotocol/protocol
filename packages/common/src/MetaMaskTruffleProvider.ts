/* eslint-disable @typescript-eslint/no-explicit-any */
import MetaMaskConnector from "node-metamask";
import minimist from "minimist";
import type { AbstractProvider } from "web3-core";
const argv = minimist(process.argv.slice());

type MetamaskProvider = ReturnType<MetaMaskConnector["getProvider"]>;

// Wraps the MetaMask Connector enabling truffle to init a web3 provider and continue truffle execution until the
// MetaMask connection has been established. This calls metaMask asynchronously while returning a provider synchronously.
export class MetaMaskTruffleProvider implements AbstractProvider {
  public wrappedProvider: MetamaskProvider | null;
  public wrappedProviderPromise: Promise<MetamaskProvider>;
  constructor() {
    this.wrappedProvider = null;
    this.wrappedProviderPromise = this.getOrConstructWrappedProvider();
  }

  // Passes the call through, by attaching a callback to the wrapper provider promise.
  sendAsync(...all: Parameters<AbstractProvider["sendAsync"]>): void {
    this.wrappedProviderPromise.then((wrappedProvider) => {
      wrappedProvider.sendAsync(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  send(...all: Parameters<NonNullable<AbstractProvider["send"]>>): void {
    this.wrappedProviderPromise.then((wrappedProvider: MetamaskProvider) => {
      wrappedProvider.send(...all);
    });
  }

  // Returns the underlying wrapped provider.
  getWrappedProviderOrThrow(): MetamaskProvider {
    if (this.wrappedProvider) {
      return this.wrappedProvider;
    } else {
      throw "Must init provider first, can't get value synchronously";
    }
  }

  // Returns a Promise that resolves to the wrapped provider.
  getOrConstructWrappedProvider(): Promise<MetamaskProvider> {
    // Only if the network is MetaMask should we init the wrapped provider.
    if (argv.network != "metamask") {
      new Promise<MetamaskProvider>(() => {
        /* do nothing */
      });
    }
    console.log(
      "Using MetaMask as your Truffle provider. To connect navigate your browser to http://localhost:3333 and sign into your account.\nAll transactions will be proceeded by your MetaMask wallet. Ensure that you do not switch your network during usage of the CLI utility."
    );

    if (this.wrappedProvider) {
      return Promise.resolve(this.wrappedProvider);
    }
    const connector = new MetaMaskConnector({
      port: 3333,
      onConnect() {
        console.log("MetaMask client connected!");
      },
    });

    return connector.start().then(() => {
      return connector.getProvider();
    });
  }
}
