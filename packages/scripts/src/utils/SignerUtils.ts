const args = require("minimist")(process.argv.slice(2));
import minimist from "minimist";
const argv = minimist(process.argv.slice());
import fs from "fs";
import kms from "@google-cloud/kms";
import { Storage } from "@google-cloud/storage";

import { Wallet } from "ethers";

export interface GckmsConfig {
  [network: string]: {
    [keyName: string]: KeyConfig;
  };
}

export interface KeyConfig {
  projectId: string;
  locationId: string;
  keyRingId: string;
  cryptoKeyId: string;
  ciphertextBucket: string;
  ciphertextFilename: string;
}

function arrayify(input: string[] | string | undefined): string[] {
  if (!input) return [];
  if (!Array.isArray(input)) return [input];
  return input;
}

interface PublicNetworksType {
  [networkId: number]: {
    name: string;
    ethFaucet?: null | string;
    etherscan: string;
    daiAddress?: string;
    wethAddress?: string;
    customTruffleConfig?: {
      confirmations: number;
      timeoutBlocks: number;
    };
  };
}

export const PublicNetworks: PublicNetworksType = {
  1: {
    name: "mainnet",
    etherscan: "https://etherscan.io/",
    daiAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    wethAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  3: {
    name: "ropsten",
    ethFaucet: "https://faucet.metamask.io/",
    etherscan: "https://ropsten.etherscan.io/",
    daiAddress: "0xB5E5D0F8C0cbA267CD3D7035d6AdC8eBA7Df7Cdd",
    wethAddress: "0xc778417E063141139Fce010982780140Aa0cD5Ab",
  },
  4: {
    name: "rinkeby",
    ethFaucet: "https://faucet.rinkeby.io/",
    etherscan: "https://rinkeby.etherscan.io/",
    daiAddress: "0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa",
    wethAddress: "0xc778417E063141139Fce010982780140Aa0cD5Ab",
  },
  5: { name: "goerli", etherscan: "https://goerli.etherscan.io/" },
  10: { name: "optimism", etherscan: "https://optimistic.etherscan.io/" },
  42: {
    name: "kovan",
    ethFaucet: "https://faucet.kovan.network/",
    etherscan: "https://kovan.etherscan.io/",
    daiAddress: "0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99",
    wethAddress: "0xd0A1E359811322d97991E03f863a0C30C2cF029C",
  },
  69: { name: "optimism-kovan", etherscan: "https://kovan-optimistic.etherscan.io/" },
  100: { name: "xdai", etherscan: "https://blockscout.com/xdai/mainnet" },
  137: {
    name: "polygon-matic",
    etherscan: "https://polygonscan.com/",
    customTruffleConfig: { confirmations: 2, timeoutBlocks: 200 },
  },
  288: { name: "boba", etherscan: "https://blockexplorer.boba.network/" },
  416: { name: "sx", etherscan: "https://explorer.sx.technology/" },
  80001: {
    name: "polygon-mumbai",
    etherscan: "https://mumbai.polygonscan.com/",
    customTruffleConfig: { confirmations: 2, timeoutBlocks: 200 },
  },
  42161: { name: "arbitrum", etherscan: "https://arbiscan.io/" },
  43114: { name: "avalanche", etherscan: "https://snowtrace.io/" },
  421611: { name: "arbitrum-rinkeby", etherscan: "https://testnet.arbiscan.io/" },
};

export function isPublicNetwork(name: string): boolean {
  return Object.values(PublicNetworks).some((network) => name.startsWith(network.name));
}

export function getGckmsConfig(keys = arrayify(argv.keys), network = argv.network): KeyConfig[] {
  let configOverride: GckmsConfig = {};

  // If there is no env variable providing the config, attempt to pull it from a file.
  // TODO: this is kinda hacky. We should refactor this to only take in the config using one method.
  if (process.env.GCKMS_CONFIG) {
    // If the env variable is present, just take that json.
    configOverride = JSON.parse(process.env.GCKMS_CONFIG);
  } else {
    // Import the .GckmsOverride.js file if it exists.
    // Note: this file is expected to be present in the same directory as this script.
    const overrideFname = ".GckmsOverride.js";
    try {
      if (fs.existsSync(`${__dirname}/${overrideFname}`)) {
        configOverride = require(`./${overrideFname}`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const getNetworkName = () => {
    if (isPublicNetwork(network || "unknown")) {
      // Take everything before the underscore:
      // mainnet_gckms -> mainnet.
      return network.split("_")[0];
    }

    return "mainnet";
  };

  // Compose the exact config for this network.
  const networkConfig = configOverride[getNetworkName()];

  // Provide the configs for the keys requested.
  const keyConfigs = ["deployer"].map((keyName) => {
    return networkConfig[keyName] || {};
  });

  return keyConfigs;
}

export async function retrieveGckmsKeys(gckmsConfigs: KeyConfig[]): Promise<string[]> {
  return await Promise.all(
    gckmsConfigs.map(async (config) => {
      const storage = new Storage();
      const keyMaterialBucket = storage.bucket(config.ciphertextBucket);
      const ciphertextFile = keyMaterialBucket.file(config.ciphertextFilename);

      const contentsBuffer = (await ciphertextFile.download())[0];
      const ciphertext = contentsBuffer.toString("base64");

      // Send the request to decrypt the downloaded file.
      const client = new kms.KeyManagementServiceClient();
      const name = client.cryptoKeyPath(config.projectId, config.locationId, config.keyRingId, config.cryptoKeyId);
      const [result] = await client.decrypt({ name, ciphertext });
      if (!(result.plaintext instanceof Uint8Array)) throw new Error("result.plaintext wrong type");
      return "0x" + Buffer.from(result.plaintext).toString().trim();
    })
  );
}

// export async function getSigner(): Promise<Wallet> {
//   if (!Object.keys(args).includes("wallet")) throw new Error("Must define mnemonic, privatekey or gckms for wallet");
//   if (args.wallet === "mnemonic") return getMnemonicSigner();
//   if (args.wallet === "privateKey") return getPrivateKeySigner();
//   if (args.wallet === "gckms") return await getGckmsSigner();
// }

function getPrivateKeySigner() {
  if (!process.env.PRIVATE_KEY) throw new Error(`Wallet private key selected but no PRIVATE_KEY env set!`);
  return new Wallet(process.env.PRIVATE_KEY);
}

export async function getGckmsSigner() {
  //   if (!args.keys) throw new Error(`Wallet GCKSM selected but no keys parameter set! Set GCKMS key to use`);
  const privateKeys = await retrieveGckmsKeys(getGckmsConfig([args.keys]));
  return new Wallet(privateKeys[0]); // GCKMS retrieveGckmsKeys returns multiple keys. For now we only support 1.
}

function getMnemonicSigner() {
  if (!process.env.MNEMONIC) throw new Error(`Wallet mnemonic selected but no MNEMONIC env set!`);
  return Wallet.fromMnemonic(process.env.MNEMONIC);
}
