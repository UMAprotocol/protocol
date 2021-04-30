import fs from "fs";
import path from "path";
import { getWeb3 } from "@uma/common";
// eslint-disable-next-line prettier/prettier
import type Web3 from "web3";
import { findContractVersion } from "./src/FindContractVersion";
const truffleContract = require("@truffle/contract");

// Re-export the types from index.ts for truffle and ethers for convenience.
// Note: because typechain doesn't construct a web3 index.d.ts, we'd have to import each type manually.
import type * as TruffleContracts from "./contract-types/truffle";
import type * as EthersContracts from "./contract-types/ethers";
export type { TruffleContracts, EthersContracts };

declare const hardhatTestingAddresses: any;

type GenericArtifacts = (typeof artifacts) & {
  require: (name: string) => Truffle.ContractInstance,
  _provisioner: any
}

type TruffleContractI = Truffle.ContractInstance & {
  networks: {
    [key: number]: {
      address: string
    }
  }
}

/**
 * @notice Gets the directory for version of core specified by an input version string.
 * @param {String} version Version string in the form of x.y.z.
 */
const getDirectoryForVersion = (version: string): string => {
  // Note: this establishes a convention where any previous core version that is pulled in here must be aliased in the
  // package.json file as follows:
  // "@uma/core-x-y-z": "npm:@uma/core@x.y.z"
  // This forces yarn to pull the package @uma/core with version x.y.z into a local package name/folder with name
  // @uma/core-x-y-z.
  // To reiterate: any version passed in here must be listed in the package.json.
  const packageName = `@uma/core-${version.split(".").join("-")}`;
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

/**
 * @notice Gets the truffle artifact for an UMA contract.
 * @param {String} contractName Name of the UMA contract whose artifact object will be returned.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
const getArtifact = (contractName: string, version = "latest"): any => {
  const contractDirectory = version === "latest" ? __dirname : getDirectoryForVersion(version);
  const filePath = path.join(contractDirectory, "build", "contracts", `${contractName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No contract artifact found at ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath).toString());
}

/**
 * @notice Gets the abi for an UMA contract.
 * @param {String} contractName Name of the UMA contract whose abi will be returned.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
let getAbi = (contractName: string, version = "latest"): any => {
  const artifact = getArtifact(contractName, version);
  return artifact.abi;
}

/**
 * @notice Gets the deployed address for an UMA contract.
 * @param {String} contractName Name of the UMA contract whose address will be returned.
 * @param {Integer} networkId Network ID of the network where that contract is deployed.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
let getAddress = (contractName: string, networkId: number, version = "latest"): string | null => {
  const artifact = getArtifact(contractName, version);

  if (!artifact.networks[networkId]) {
    return null;
    // For now we will return null to not break upstream tests in some edge cases, like the serverless bots.
    // throw new Error(`No deployment of ${contractName} found for network ${networkId}`);
  }
  return artifact.networks[networkId].address;
}

/**
 * @notice Creates a new truffle contract instance based on an existing web3 instance (using its provider).
 * If a web3 instance is not provided, this function will use getWeb3() to attempt to create one.
 * @param {String} contractName Name of the UMA contract to be instantiated.
 * @param {Object} [web3] Custom web3 instance whose provider should be injected into the truffle contract.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
let getTruffleContract = (contractName: string, web3: Web3 | undefined, version = "latest"): TruffleContractI => {
  // If there is no web3, use getWeb3() to retrieve one.
  const resolvedWeb3 = web3 || getWeb3();

  const artifact = getArtifact(contractName, version);
  const Contract = truffleContract(artifact);
  Contract.setProvider(resolvedWeb3.currentProvider);
  return Contract as TruffleContractI;
}

/**
 * @notice Creates a new truffle contract instance using artifacts. This method will automatically be exported instead
 * of the above method in the case that this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract to be instantiated.
 * @param {Object} [web3] web3 object, only used in the case that version != latest.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
const getTruffleContractTest = (contractName: string, web3: Web3 | undefined, version = "latest"): TruffleContractI => {
  return version === "latest"
    ? (artifacts as GenericArtifacts).require(contractName) as TruffleContractI
    : getTruffleContract(contractName, web3, version);
}

/**
 * @notice Gets the contract address. This method will automatically be exported instead of getAdress in the case that
 * this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract whose address is to be retrieved.
 * @param {Integer} networkId  Network ID of the network where that contract is deployed.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
const getAddressTest = (contractName: string, networkId: number, version = "latest"): string => {
  const truffleContract = getTruffleContractTest(contractName, undefined, version);

  const { _provisioner } = (artifacts as GenericArtifacts);
  if (truffleContract.networks[networkId]) {
    return truffleContract.networks[networkId].address;
  } else if (
    _provisioner?._deploymentAddresses[contractName] &&
    _provisioner?._networkConfig.chainId === networkId
  ) {
    // In the production hardhat case, there is no networks object, so we fall back to hardhat's global list of deployed addresses as long as hardhat's network id matches the one passed in.
    // Note: this is a bit hacky because it depends on internal hardhat details.
    return _provisioner._deploymentAddresses[contractName];
  } else if (hardhatTestingAddresses[contractName]) {
    // If running tests in hardhat, check if there is a testing address set.
    return hardhatTestingAddresses[contractName];
  } else {
    throw new Error(`No address found for contract ${contractName} on network ${networkId}`);
  }
}

/**
 * @notice Gets the contract abi. This method will automatically be exported instead of getAbi() in the case that
 * this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract whose abi is to be retrieved.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
const getAbiTest = (contractName: string, version = "latest"): any => {
  const truffleContract = getTruffleContractTest(contractName, undefined, version);
  return truffleContract.abi;
}

if (artifacts) {
  getAbi = getAbiTest;
  getAddress = getAddressTest;
  getTruffleContract = getTruffleContractTest;
}

export { getAbi, getAddress, getTruffleContract, findContractVersion };