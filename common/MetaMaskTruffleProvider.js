const MetaMaskConnector = require("node-metamask");
const argv = require("minimist")(process.argv.slice());

class MetaMaskTruffleProvider {
  constructor() {
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
    this.wrappedProviderPromise.then(wrappedProvider => {
      wrappedProvider.send(...all);
    });
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
    if (argv.network != "metamask") {
      return;
    }
    console.log(
      "Using MetaMask as your Truffle provider. To connect navigate your browser to http://localhost:3333 and sign into your account.\nAll transactions will be proceeded by your Metamask wallet. Ensure that you do not switch your network during usage of the CLI utility."
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

module.exports = MetaMaskTruffleProvider;
