const MetaMaskConnector = require("node-metamask");
const argv = require("minimist")(process.argv.slice());

// Wraps the MetaMask Connector enabling truffle to init a web3 provider and continue truffle execution until the
// MetaMask connection has been established. This calls metaMask asynchronously while returning a provider synchronously.
class MetaMaskTruffleProvider {
  constructor() {
    this.wrappedProvider = null;
    this.wrappedProviderPromise = this.getOrConstructWrappedProvider();
  }

  // Passes the call through, by attaching a callback to the wrapper provider promise.
  sendAsync(...all) {
    this.wrappedProviderPromise.then(wrappedProvider => {
      wrappedProvider.sendAsync(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  send(...all) {
    this.wrappedProviderPromise.then(wrappedProvider => {
      wrappedProvider.send(...all);
    });
  }

  // Passes the call through. Requires that the wrapped provider has been created via, e.g., `constructWrappedProvider`.
  getAddress(...all) {
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
    // Only if the network is MetaMask should we init the wrapped provider.
    if (argv.network != "metamask") {
      return;
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
      }
    });

    return connector.start().then(() => {
      return connector.getProvider();
    });
  }
}

module.exports = { MetaMaskTruffleProvider };
