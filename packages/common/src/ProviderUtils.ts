// This client exports a web3 instance which mimics that created by the default Truffle config. It exclusively uses
// web3 providers to take advantage of the flexibility of providing custom configs to tailor the desired options. The network
// syntax mimics that of the main UMA Truffle implementation to make this backwards compatible.

import Web3 from "web3";
import { getTruffleConfig, getNodeUrl } from "./TruffleConfig";
import minimist from "minimist";
import Url from "url";
import { RetryProvider, RetryConfig } from "./RetryProvider";
import { AbstractProvider } from "web3-core";
import HDWalletProvider from "@truffle/hdwallet-provider";
import { ManagedSecretProvider } from "./gckms/ManagedSecretProvider";
import { getGckmsConfig } from "./gckms/GckmsConfig";
import assert from "assert";

const argv = minimist(process.argv.slice(), { string: ["network"] });

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

export function createBasicProvider(nodeRetryConfig: RetryConfig[]): RetryProvider {
  return new RetryProvider(
    nodeRetryConfig.map(
      (configElement: RetryConfig): RetryConfig => {
        const protocol = Url.parse(configElement.url).protocol;
        if (protocol === null) throw new Error(`No protocol detected for url: ${configElement.url}`);
        let options: RetryConfig["options"] = {
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
        return { ...configElement, options };
      }
    )
  );
}

export const KEY_TYPES = ["gckms", "mnemonic", "none"] as const;

export function getDetaultKeyType(): typeof KEY_TYPES[number] {
  if (argv.network) {
    const networkSplit = argv.network.split("_");
    const keyType = networkSplit[networkSplit.length - 1];
    if (KEY_TYPES.includes(keyType)) {
      return keyType;
    }
  }
  return "none";
}

export function addMnemonicToProvider(
  provider: AbstractProvider,
  mnemonic: string = process.env.MNEMONIC ||
    "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat",
  numKeys = process.env.NUM_KEYS ? parseInt(process.env.NUM_KEYS) : 2,
  keyOffset = process.env.KEY_OFFSET ? parseInt(process.env.KEY_OFFSET) : 0
): HDWalletProvider {
  return new HDWalletProvider(mnemonic, provider, keyOffset, numKeys);
}

export function addGckmsToProvider(provider: AbstractProvider): ManagedSecretProvider {
  const gckmsConfig = getGckmsConfig();
  return new ManagedSecretProvider(gckmsConfig, provider, 0, gckmsConfig.length);
}

export const PUBLIC_NETWORKS = {
  mainnet: {
    chainId: 1,
    infuraName: "mainnet",
  },
  kovan: {
    chainId: 42,
    infuraName: "kovan",
  },
  goerli: {
    chainId: 5,
    infuraName: "goerli",
  },
  rinkeby: {
    chainId: 4,
    infuraName: "rinkeby",
  },
  matic: {
    chainId: 137,
    infuraName: "polygon-mainnet",
  },
  mumbai: {
    chainId: 137,
    infuraName: "polygon-mainnet",
  },
  optimism: {
    chainId: 137,
    infuraName: "polygon-mainnet",
  },
} as const;

export const OTHER_NETWORKS = ["localhost", "hardhat", "test"] as const;

type PublicNetworkName = keyof typeof PUBLIC_NETWORKS;
type OtherNetworkName = typeof OTHER_NETWORKS[number];
type NetworkName = PublicNetworkName | OtherNetworkName;

export function isPublicNetwork(network: string): network is keyof typeof PUBLIC_NETWORKS {
  return Object.keys(PUBLIC_NETWORKS).includes(network);
}

export function isOtherNetwork(network: string): network is typeof OTHER_NETWORKS[number] {
  return network in OTHER_NETWORKS;
}

export function isNetworkName(network: string): network is NetworkName {
  return isPublicNetwork(network) || network in OTHER_NETWORKS;
}

export function getDefaultNetwork(): NetworkName {
  if (!argv.network) return "test";
  const prefix = argv.network.split("_")[0];
  if (isPublicNetwork(prefix)) return prefix;
  if (isNetworkName(argv.network)) return argv.network;
  throw new Error(`Unrecognized network name ${argv.network}`);
}

export function getNodeUrl(networkName: string, useHttps = false): string {
  if (isPublicNetwork(networkName) && !networkName.includes("fork")) {
    const infuraApiKey = process.env.INFURA_API_KEY || "e34138b2db5b496ab5cc52319d2f0299";
    const name = networkName.split("_")[0];
    return (
      process.env.CUSTOM_NODE_URL ||
      (useHttps ? `https://${name}.infura.io/v3/${infuraApiKey}` : `wss://${name}.infura.io/ws/v3/${infuraApiKey}`)
    );
  }

  const port = process.env.CUSTOM_LOCAL_NODE_PORT || "9545";
  return `http://127.0.0.1:${port}`;
}

export function getUrlForPublicNetwork(networkName: PublicNetworkName, useHttps: boolean): string {
  assert(process.env.INFURA_API_KEY, "No infura key provided");
  return useHttps
    ? `https://${PUBLIC_NETWORKS[networkName].infuraName}.infura.io/v3/${process.env.INFURA_API_KEY}`
    : `wss://${PUBLIC_NETWORKS[networkName].infuraName}.infura.io/ws/v3/${process.env.INFURA_API_KEY}`;
}

export function constructRetryConfig(urlsOrNetworkNames: (PublicNetworkName | string)[], retryParameters: Omit<RetryConfig, "url"> = { retries: 3, delay: 1 }, useHttps = false): RetryConfig[] {
  return urlsOrNetworkNames.map(urlOrNetworkName => {
    const url = isPublicNetwork(urlOrNetworkName) ? getUrlForPublicNetwork(urlOrNetworkName, useHttps) : urlOrNetworkName;
    return {
      url,
      ...retryParameters
    };
  })
}

export function createWeb3Instance(retryConfig?: RetryConfig[], keyType?: typeof KEY_TYPES[number]): Web3;
export function createWeb3Instance(
  urlOrNetworkName?: string | NetworkName,
  keyType?: typeof KEY_TYPES[number],
  useHttps?: boolean
): Web3;

// Implementation
export function createWeb3Instance(
  retryConfigOrUrlOrName: RetryConfig[] | string | NetworkName = getDefaultNetwork(),
  keyType = getDetaultKeyType(),
  useHttps = false
): Web3 {
  let retryConfig: RetryConfig[];
  if (typeof retryConfigOrUrlOrName === "string") {
    if (isOtherNetwork(netowrk)) 
  }
  const retryConfig: RetryConfig[] =
    typeof retryConfigOrNodeUrl === "string" ? [{ url: retryConfigOrNodeUrl, retries: 0 }] : retryConfigOrNodeUrl;

  const basicProvider = createBasicProvider(retryConfig);

  // Use the basic provider to create a provider with an unlocked wallet. This piggybacks off the UMA common TruffleConfig
  // implementing all networks & wallet types. EG: mainnet_mnemonic, kovan_gckms. If no argv.network, assume mnemonic.
  // Note: the network itself is inconsequential since we're injecting our own url. The only thing that matters is how
  // the keys are provided. So, in effect, only the mnemonic or gckms portion really matters here.
  const providerName = argv.network || "mainnet_mnemonic";
  const provider = getTruffleConfig().networks[providerName].provider;

  function isCallable(
    input: typeof provider
  ): input is (inputProviderOrUrl?: AbstractProvider | string) => AbstractProvider {
    return input instanceof Function;
  }

  if (!isCallable(provider)) throw new Error(`Null or string provider for network ${providerName}`);
  const providerWithWallet = provider(basicProvider);

  // Lastly, create a web3 instance with the wallet-based provider. This can be used to query the chain via the
  // a basic web3 provider & has access to the users wallet based on the kind of connection they created.
  return new Web3(providerWithWallet);
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
  const provider = getTruffleConfig().networks[network].provider;

  function isCallable(
    input: typeof provider
  ): input is (inputProviderOrUrl?: AbstractProvider | string) => AbstractProvider {
    return input instanceof Function;
  }

  if (!isCallable(provider)) throw new Error(`Null or string provider for network ${network}`);
  const providerWithWallet = provider(basicProvider);

  // Lastly, create a web3 instance with the wallet-based provider. This can be used to query the chain via the
  // a basic web3 provider & has access to the users wallet based on the kind of connection they created.
  web3 = new Web3(providerWithWallet);

  return web3;
}
