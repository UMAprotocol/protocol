// This client exports a web3 instance which mimics that created by the default Truffle config. It exclusively uses
// web3 providers to take advantage of the flexibility of providing custom configs to tailor the desired options. The network
// syntax mimics that of the main UMA Truffle implementation to make this backwards compatible.

import Web3 from "web3";
import minimist from "minimist";
import Url from "url";
import { RetryProvider, RetryConfig } from "./RetryProvider";
import { AbstractProvider } from "web3-core";
import HDWalletProvider from "@truffle/hdwallet-provider";
import { ManagedSecretProvider } from "./gckms/ManagedSecretProvider";
import { getGckmsConfig } from "./gckms/GckmsConfig";
import { isPublicNetwork } from "./PublicNetworks";
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

export function getNodeUrl(networkName: string, useHttps = false, chainId: number | null = null): string {
  if (isPublicNetwork(networkName) && !networkName.includes("fork")) {
    const infuraApiKey = process.env.INFURA_API_KEY || "e34138b2db5b496ab5cc52319d2f0299";
    const name = networkName.split("_")[0];

    const chainSpecificUrl = chainId !== null ? process.env[`NODE_URL_${chainId}`] : null;
    const overrideUrl = chainSpecificUrl || process.env.CUSTOM_NODE_URL;

    // Note: Neither Boba nor xDai currently has no infura support.
    if (name === "boba") return overrideUrl || "https://mainnet.boba.network/";
    if (name === "xdai") return overrideUrl || "https://rpc.xdaichain.com/";
    if (name === "sx") return overrideUrl || "https://rpc.sx.technology";
    if (name === "avalanche") return overrideUrl || "https://api.avax.network/ext/bc/C/rpc";
    if (name === "evmos") return overrideUrl || "https://evmos-json-rpc.stakely.io";
    if (name === "meter") return overrideUrl || "https://rpc.meter.io";
    if (name === "core-testnet") return overrideUrl || "https://rpc.test.btcs.network/";
    if (name === "blast-sepolia") return overrideUrl || "https://sepolia.blast.io";
    if (name === "core") return overrideUrl || "https://rpc.coredao.org/";
    if (name === "base-goerli") return overrideUrl || "https://goerli.base.org";
    if (name === "base-sepolia") return overrideUrl || "https://sepolia.base.org";
    if (name === "base") return overrideUrl || "https://mainnet.base.org";
    if (name === "blast") return overrideUrl || "https://rpc.blast.io/";
    if (name === "illiad") return overrideUrl || "https://testnet.storyrpc.io/";
    if (name === "odyssey") return overrideUrl || "https://odyssey-testnet-explorer.storyscan.xyz";
    return (
      overrideUrl ||
      (useHttps ? `https://${name}.infura.io/v3/${infuraApiKey}` : `wss://${name}.infura.io/ws/v3/${infuraApiKey}`)
    );
  }

  const port = process.env.CUSTOM_LOCAL_NODE_PORT || "9545";
  return `http://127.0.0.1:${port}`;
}

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

const KEY_TYPES = ["gckms", "mnemonic", "none"] as const;

function isKeyType(input: string): input is typeof KEY_TYPES[number] {
  return KEY_TYPES.some((keyType) => keyType === input);
}

function getDefaultKeyType(network: string): typeof KEY_TYPES[number] {
  if (network) {
    const networkSplit = network.split("_");
    const keyType = networkSplit[networkSplit.length - 1];
    if (isKeyType(keyType)) {
      return keyType;
    }
  }
  return "none";
}

export function getMnemonic(): string {
  return process.env.MNEMONIC || "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";
}

function addMnemonicToProvider(
  provider: AbstractProvider,
  mnemonic: string = getMnemonic(),
  numKeys = parseInt(process.env.NUM_KEYS || "2"),
  keyOffset = process.env.KEY_OFFSET ? parseInt(process.env.KEY_OFFSET) : 0
): HDWalletProvider {
  return new HDWalletProvider(mnemonic, provider, keyOffset, numKeys);
}

function addGckmsToProvider(provider: AbstractProvider): ManagedSecretProvider {
  const gckmsConfig = getGckmsConfig();
  return new ManagedSecretProvider(gckmsConfig, provider, 0, gckmsConfig.length);
}

function addDefaultKeysToProvider(provider: AbstractProvider, network: string = argv.network): AbstractProvider {
  switch (getDefaultKeyType(network)) {
    case "gckms":
      return addGckmsToProvider(provider);
    case "mnemonic":
      return addMnemonicToProvider(provider);
    case "none":
    default:
      return provider;
  }
}

/**
 * @notice Creates a web3 instance for a particular chain.
 * @param chainId the chain id for the network the user wants to connect to.
 * @returns new Web3 instance.
 */
export function getWeb3ByChainId(chainId: number): Web3 {
  const retryConfigJson = process.env[`RETRY_CONFIG_${chainId}`];
  const nodeUrl = process.env[`NODE_URL_${chainId}`];
  let retryConfig: RetryConfig[];
  if (retryConfigJson) retryConfig = JSON.parse(retryConfigJson);
  else {
    assert(nodeUrl, `NODE_URL_${chainId} or RETRY_CONFIG_${chainId} must be provided!`);
    // Special case: if the user supplies a node url of "test", just return the global web3 object.
    if (nodeUrl === "test") return ((global as unknown) as { web3: Web3 }).web3;
    retryConfig = [{ url: nodeUrl, retries: 2, delay: 1 }];
  }

  const keylessProvider = createBasicProvider(retryConfig);
  const keyedProvider = addDefaultKeysToProvider(keylessProvider);
  return new Web3(keyedProvider);
}

/**
 * @notice Creates array of web3 instances for a particular chain.
 * @dev Providers to use are described in RETRY_CONFIG_{chainId} dictionary under the "url" key.
 * @param chainId the chain id for the network the user wants to connect to.
 * @returns array of new readonly Web3 instances.
 */
export function getRetryWeb3sByChainId(chainId: number): Web3[] {
  const retryConfigJson = process.env[`RETRY_CONFIG_${chainId}`] || "[]";
  const retryConfig: RetryConfig[] = JSON.parse(retryConfigJson);

  if (retryConfig.length === 0) {
    const providerUrl = process.env[`NODE_URL_${chainId}`];
    if (!providerUrl) throw new Error(`No providers found for chain id ${chainId}`);
    return [new Web3(providerUrl)];
  }

  return retryConfig.map((config) => new Web3(createBasicProvider([config])));
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

  const providerWithWallet = addDefaultKeysToProvider(basicProvider, network);

  // Lastly, create a web3 instance with the wallet-based provider. This can be used to query the chain via the
  // a basic web3 provider & has access to the users wallet based on the kind of connection they created.
  web3 = new Web3(providerWithWallet);

  return web3;
}
