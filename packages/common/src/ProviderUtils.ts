// This client exports a web3 instance which mimics that created by the default Truffle config. It exclusively uses
// web3 providers to take advantage of the flexibility of providing custom configs to tailor the desired options. The network
// syntax mimics that of the main UMA Truffle implementation to make this backwards compatible.

import Web3 from "web3";
import { getTruffleConfig, getNodeUrl } from "./TruffleConfig";
import minimist from "minimist";
import Url from "url";
import { RetryProvider } from "./RetryProvider";
const argv = minimist(process.argv.slice(), { string: ["network"] });

interface Retry {
  retries: number;
  delay: number;
  url: string;
}

type RetryConfig = Retry[];

// NODE_RETRY_CONFIG should be a JSON of the form (retries and delay are optional, they default to 1 and 0 respectively):
// [
//    {
//      retries: 3,
//      delay: 1
//      url: https://mainnet.infura.io/v3/ACCOUNT_ID,
//    },
//    {
//      retries: 5,
//      delay: 1,
//      url: ws://99.999.99.99
//    }
// ]
const { NODE_RETRY_CONFIG } = process.env;

// Set web3 to null
let web3: Web3 | null = null;

export function createBasicProvider(nodeRetryConfig: RetryConfig): RetryProvider {
  type RetryProviderConstructorParam = ConstructorParameters<typeof RetryProvider>[0];
  return new RetryProvider(
    nodeRetryConfig.map(
      (configElement): RetryProviderConstructorParam => {
        const protocol = Url.parse(configElement.url).protocol;
        if (protocol === null) throw new Error(`No protocol detected for url: ${configElement.url}`);
        let options: RetryProviderConstructorParam["options"] = {
          timeout: 10000, // 10 second timeout
        };

        if (protocol.startsWith("ws")) {
          // Websocket
          options = {
            ...options,
            clientConfig: {
              maxReceivedFrameSize: 100000000, // Useful if requests result are large bytes - default: 1MiB
              maxReceivedMessageSize: 100000000, // bytes - default: 8MiB
            },
            reconnect: {
              auto: true, // Enable auto reconnection
              delay: 5000, // ms
              maxAttempts: 10,
              onTimeout: false,
            },
          };
        }
        return { options, ...configElement };
      }
    )
  );
}

/**
 * @notice Gets a web3 instance based on the network argument using the truffle config in this package.
 * Use this for compatibility for running with or without truffle.
 * @example
 *  If a node app uses getWeb3() and you want to load network 1 with a default wallet For full list of potential network
 * names see common/src/TruffleConfig node app --network=mainnet_mnemonic
 *
 * @notice You can also specify environment variables INFURA_API_KEY, CUSTOM_NODE_URL and CUSTOM_LOCAL_NODE_PORT.
 * If not provided there are defaults which load a hardcoded infura key. Default port is 9545.
 *
 * @notice a parameterizedNetwork name can also be provided. This enables you to use the library without needing to define
 * a `--network` argument. Useful in serverless or when running node scripts.
 *
 */
export function getWeb3(parameterizedNetwork = "test"): Web3 {
  const castedGlobal = (global as unknown) as { web3: Web3 | undefined };
  if (castedGlobal.web3) return castedGlobal.web3;

  // If a web3 instance has already been initialized, return it.
  if (web3) return web3;

  // Create basic web3 provider with no wallet connection based on the url alone.
  const network = argv.network || parameterizedNetwork; // Default to the test network (local network).
  const nodeRetryConfig = NODE_RETRY_CONFIG
    ? JSON.parse(NODE_RETRY_CONFIG)
    : [{ url: getNodeUrl(network), retries: 0 }];
  const basicProvider = createBasicProvider(nodeRetryConfig);

  // Use the basic provider to create a provider with an unlocked wallet. This piggybacks off the UMA common TruffleConfig
  // implementing all networks & wallet types. EG: mainnet_mnemonic, kovan_gckms. Errors if no argv.network.
  const providerWithWallet = getTruffleConfig().networks[network].provider(basicProvider);

  // Lastly, create a web3 instance with the wallet-based provider. This can be used to query the chain via the
  // a basic web3 provider & has access to the users wallet based on the kind of connection they created.
  web3 = new Web3(providerWithWallet);

  return web3;
}
