const Web3 = require("web3");
const HDWalletProvider = require("@truffle/hdwallet-provider");

var options = {
  timeout: 10000, // ms
  // Useful if requests result are large
  clientConfig: {
    maxReceivedFrameSize: 100000000, // bytes - default: 1MiB
    maxReceivedMessageSize: 100000000 // bytes - default: 8MiB
  },
  // Enable auto reconnection
  reconnect: {
    auto: true,
    delay: 5000, // ms
    maxAttempts: 5,
    onTimeout: false
  }
};

// If a custom infuraApiKey is provided, use that. Else, fallback to a public one.
const infuraApiKey = process.env.INFURA_API_KEY ? process.env.INFURA_API_KEY : "e34138b2db5b496ab5cc52319d2f0299";

// If a custom node URL is provided, use that. Otherwise use an infura websocket connection.
const nodeUrl = process.env.CUSTOM_NODE_URL || `wss://mainnet.infura.io/ws/v3/${infuraApiKey}`;

// Create the websocket provider using the nodeURL and options.
const websocketProvider = new Web3.providers.WebsocketProvider(nodeUrl, options);

// If the user provided a mnemonic OR a private key, take it. If not, this is null.
const mnemonicOrPrivateKey = process.env.MNEMONIC | process.env.PRIVATE_KEY;

// If the user provided a mnemonic or private key, use this as the selected key. Else, default to a public mnemonic
const selectedKey = mnemonicOrPrivateKey
  ? mnemonicOrPrivateKey
  : "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";

const hdWalletWithWebsocketProvider = new HDWalletProvider(selectedKey, websocketProvider);

const web3 = new Web3(hdWalletWithWebsocketProvider);

console.log("Created websocket web3 provider");

module.exports = { web3 };
