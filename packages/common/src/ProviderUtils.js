// This client exports a web3 instance which mimics that created by the default Truffle config. It exclusively uses
// web3 providers to take advantage of the flexibility of providing custom configs to tailor the desired options. The network
// syntax mimics that of the main UMA Truffle implementation to make this backwards compatible.

const Web3 = require("web3");
const { getTruffleConfig, getNodeUrl } = require("./TruffleConfig");
const argv = require("minimist")(process.argv.slice(), { string: ["network"] });
const Url = require("url");

// Set web3 to null
let web3 = null;

function createBasicProvider(url) {
  const protocol = Url.parse(url).protocol;

  // 10 second timeout
  const timeout = 10000;

  if (protocol.startsWith("ws")) {
    // Websocket
    const websocketOptions = {
      timeout, // ms
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
    return new Web3.providers.WebsocketProvider(url, websocketOptions);
  } else {
    // If it isn't websocket, assume http.
    const httpOptions = {
      timeout
    };

    return new Web3.providers.HttpProvider(url, httpOptions);
  }
}

/**
 * @notice Gets a web3 instance based on the network argument using the truffle config in this package.
 * Use this for compatibility for running with or without truffle.
 * @example
 * // If a node app uses getWeb3() and you want to load network 1 with a default wallet
 * // For full list of potential network names see common/src/TruffleConfig
 * node app --network=mainnet_mnemonic
 *
 * @notice You can also specify environment variables
 * INFURA_API_KEY, CUSTOM_NODE_URL and CUSTOM_LOCAL_NODE_PORT. If not provided there are defaults
 * which load a hardcoded infura key. Default port is 9545.
 *
 */
function getWeb3() {
  // If a web3 instance has already been initialized, return it.
  if (web3) {
    return web3;
  }

  // Create basic web3 provider with no wallet connection based on the url alone.
  const network = argv.network || "test"; // Default to the test network (local network).
  const basicProvider = createBasicProvider(getNodeUrl(network));

  // Use the basic provider to create a provider with an unlocked wallet. This piggybacks off the UMA common TruffleConfig
  // implementing all networks & wallet types. EG: mainnet_mnemonic, kovan_gckms. Errors if no argv.network.
  const providerWithWallet = getTruffleConfig().networks[network].provider(basicProvider);

  // Lastly, create a web3 instance with the wallet-based provider. This can be used to query the chain via the
  // a basic web3 provider & has access to the users wallet based on the kind of connection they created.
  web3 = new Web3(providerWithWallet);

  return web3;
}

/**
 * @notice Gets a web3 instance based on the network argument using the truffle config in this package.
 * This method will be subbed in when called in a truffle test context.
 */
function getWeb3Test() {
  return global.web3;
}

if (global.web3) {
  module.exports = { getWeb3: getWeb3Test };
} else {
  module.exports = { getWeb3 };
}
