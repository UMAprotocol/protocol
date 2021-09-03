import Web3 from "web3";
import lodash from "lodash";
import assert from "assert";
import { ZERO_ADDRESS } from "./Constants";

const { toWei, utf8ToHex, padRight } = Web3.utils;

// Versions that production bots support.
export const SUPPORTED_CONTRACT_VERSIONS = [
  { contractType: "ExpiringMultiParty", contractVersion: "2.0.1" },
  { contractType: "Perpetual", contractVersion: "2.0.1" },
];

// Versions that unit tests will test against. Note we dont test anything less than 2.0.1 as all older contracts have
// expired on mainnet.
export const TESTED_CONTRACT_VERSIONS = [
  { contractType: "ExpiringMultiParty", contractVersion: "2.0.1" },
  { contractType: "Perpetual", contractVersion: "2.0.1" },
];

export const CORE_CONTRACTS_NODE_VERSION_MAPPING = {
  "2.0.1": "0.1.0",
};

// Assumes that the contracts-node package alias is @uma/contracts-node-X-Y-Z.
// Typical workflow is:
// const { getAbi, getBytecode } = require(getContractsNodePackageAliasForVersion(versionString));
export function getContractsNodePackageAliasForVerion(version: string): string {
  if (version === "latest") return "@uma/contracts-node";
  const isKey = (input: string): input is keyof typeof CORE_CONTRACTS_NODE_VERSION_MAPPING =>
    input in CORE_CONTRACTS_NODE_VERSION_MAPPING;
  if (!isKey(version)) throw new Error("Unknown version!");
  return `@uma/contracts-node-${CORE_CONTRACTS_NODE_VERSION_MAPPING[version].split(".").join("-")}`;
}

interface Version {
  contractType: string;
  contractVersion: string;
}

/**
 * Used in conjunction with versionedIt within tests, this method will return true if the currentTestIterationVersion
 * is part of the SUPPORTED_CONTRACT_VERSIONS and supportedVersions (or is any), else returns false.
 * @param {Object} supportedVersions array of supported contract types & versions for a given test.
 * @param {Object} SUPPORTED_CONTRACT_VERSIONS array of supported contract types & versions for all tests within a test file.
 * @param {Object} currentTestIterationVersion object containing the current contract type & version for the current test.
 * @returns {bool} true of the current test iteration version is part of & supportedVersions & SUPPORTED_CONTRACT_VERSIONS
 * or any, false otherwise.
 */
export function runTestForVersion(
  supportedVersions: Version[],
  SUPPORTED_CONTRACT_VERSIONS: Version[],
  currentTestIterationVersion: Version
): boolean {
  // Validate that the array of supportedVersions provided is in the SUPPORTED_CONTRACT_VERSIONS OR is `any`.
  const supportedVersionOverlap = lodash.intersectionBy(
    supportedVersions,
    [...SUPPORTED_CONTRACT_VERSIONS, { contractType: "any", contractVersion: "any" }],
    (version) => [version.contractType, version.contractVersion].join(",")
  );
  assert(
    supportedVersionOverlap.length > 0,
    `Contract version specified in the test is not supported. Specified version${JSON.stringify(
      supportedVersions
    )} is not part of ${JSON.stringify(SUPPORTED_CONTRACT_VERSIONS)}`
  );

  // Check if the current currentTestIterationVersion is part of the supportedVersions for the specific test.
  const testSupportedVersionOverlap = lodash.intersectionBy(
    supportedVersions,
    [currentTestIterationVersion, { contractType: "any", contractVersion: "any" }],
    (version) => [version.contractType, version.contractVersion].join(",")
  );
  return testSupportedVersionOverlap.length > 0;
}

/**
 * Used in unit tests that test multiple smart contract versions at the same time, this method will create constructor
 * parameters in accordance with the contract version and execution context.
 * @param {Object} contractVersion object containing the contractVersion and Type to be used with the constructor params
 * @param {Object} contextObjects object containing nested objects which provide context on the creation of the constructor
 * params. Note each key type defined in the requiredContextObjects must be provided to correctly use this method.
 * @param {Object} overrideConstructorParams optional override for the constructor params generated.
 * @returns {Object} version compatible constructor parameters.
 */
export async function createConstructorParamsForContractVersion(
  contractVersion: Version,
  contextObjects: any,
  overrideConstructorParams = {}
): Promise<any> {
  assert(
    contractVersion && contractVersion.contractVersion && contractVersion.contractType,
    "contractVersion must be provided, containing both a contract version and type"
  );
  const requiredContextObjects = [
    "convertDecimals",
    "finder",
    "collateralToken",
    "syntheticToken",
    "identifier",
    "fundingRateIdentifier",
    "timer",
    "store",
    "configStore",
  ];

  // Check that each of the expected keys is present and not null.
  requiredContextObjects.forEach((expectedKey) => {
    assert(
      contextObjects[expectedKey] && Object.keys(contextObjects).includes(expectedKey),
      `Provided context object is missing type ${expectedKey} or is undefined`
    );
  });

  // Note: the ?s and ||s below allow this function to work with web3 or truffle object types.
  const currentTime =
    (await contextObjects.timer.getCurrentTime?.())?.toNumber() ||
    parseInt(await contextObjects.timer.methods.getCurrentTime().call());

  const constructorParams: any = {
    expirationTimestamp: currentTime + 100000,
    withdrawalLiveness: "1000",
    collateralAddress: contextObjects.collateralToken.address || contextObjects.collateralToken.options.address,
    tokenAddress: contextObjects.syntheticToken.address || contextObjects.syntheticToken.options.address,
    finderAddress: contextObjects.finder.address || contextObjects.finder.options.address,
    priceFeedIdentifier: padRight(utf8ToHex(contextObjects.identifier), 64),
    liquidationLiveness: "1000",
    collateralRequirement: { rawValue: toWei("1.2") },
    disputeBondPercentage: { rawValue: toWei("0.1") },
    sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
    disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
    minSponsorTokens: { rawValue: contextObjects.convertDecimals("5") },
    timerAddress: contextObjects.timer.address || contextObjects.timer.options.address,
    excessTokenBeneficiary: contextObjects.store.address || contextObjects.store.options.address,
    financialProductLibraryAddress: ZERO_ADDRESS,
  };

  if (contractVersion.contractType == "Perpetual") {
    constructorParams.fundingRateIdentifier = padRight(utf8ToHex(contextObjects.fundingRateIdentifier), 64);
    constructorParams.configStoreAddress =
      contextObjects.configStore.address || contextObjects.configStore.options.address;
    constructorParams.tokenScaling = { rawValue: toWei("1") };
  }

  return { ...constructorParams, ...overrideConstructorParams };
}
