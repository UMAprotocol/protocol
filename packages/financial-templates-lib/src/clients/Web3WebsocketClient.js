// This client exports a web3 instances which mimics that created by the default truffle config. It exclusively uses
// websocket connections to take advantage of reconnect logic if the websocket disconnects or times out. The network
// syntax mimics that of the main UMA Truffle implementation to make this backwards compatible.

const Web3 = require("web3");
const { getTruffleConfig, getNodeUrl } = require("@umaprotocol/common");
const argv = require("minimist")(process.argv.slice(), { string: ["network"] });

const websocketOptions = {
  timeout: 10000, // ms
  clientConfig: {
    maxReceivedFrameSize: 100000000, // Useful if requests result are large bytes - default: 1MiB
    maxReceivedMessageSize: 100000000 // bytes - default: 8MiB
  },
  reconnect: {
    auto: true, // Enable auto reconnection
    delay: 5000, // ms
    maxAttempts: 10,
    onTimeout: false
  }
};

// Create websocket web3 provider. This contains the re-try logic on failed/timeout connections.
const nodeUrl = getNodeUrl();
const websocketProvider = new Web3.providers.WebsocketProvider(nodeUrl, websocketOptions);

// Use the websocketProvider to create a provider with an unlocked wallet. This piggybacks off the UMA common TruffleConfig
// implementing all networks & wallet types. EG: mainnet_mnemonic, kovan_gckms, test, mainnet-fork. Errors if no argv.network.
const walletWithWebsocketProvider = getTruffleConfig().networks[argv.network].provider(websocketProvider);

// Lastly, create a web3 instance with the walletWithWebsocketProvider. This can be used to  queries the chain via the
// retry enabled websocket provider & has access to the users wallet based on the kind of connection they created.
const web3 = new Web3(walletWithWebsocketProvider);

module.exports = { web3 };
