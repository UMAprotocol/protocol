const web3 = require("web3");
const lodash = require("lodash");

const { toWei, utf8ToHex, padRight } = web3.utils;
const { ZERO_ADDRESS } = require("./Constants");

// Versions that production bots support.
const SUPPORTED_CONTRACT_VERSIONS = [
  { contractType: "ExpiringMultiParty", contractVersion: "1.2.0" },
  { contractType: "ExpiringMultiParty", contractVersion: "1.2.1" },
  { contractType: "ExpiringMultiParty", contractVersion: "1.2.2" },
  { contractType: "ExpiringMultiParty", contractVersion: "latest" },
  { contractType: "Perpetual", contractVersion: "latest" }
];

// Versions that unit tests will test against. Note that there is no need to re-test anything less than 1.2.2 as
// functionally these versions are identical to 1.2.2.
const TESTED_CONTRACT_VERSIONS = [
  { contractType: "ExpiringMultiParty", contractVersion: "1.2.2" },
  { contractType: "ExpiringMultiParty", contractVersion: "latest" },
  { contractType: "Perpetual", contractVersion: "latest" }
];

/**
 * Used in conjunction with versionedIt within tests, this method will return true if the currentTestIterationVersion
 * is part of the SUPPORTED_CONTRACT_VERSIONS and supportedVersions (or is any), else returns false.
 * @param {Object} supportedVersions array of supported contract types & versions for a given test.
 * @param {Object} SUPPORTED_CONTRACT_VERSIONS array of supported contract types & versions for all tests within a test file.
 * @param {Object} currentTestIterationVersion object containing the current contract type & version for the current test.
 * @returns {bool} true of the current test iteration version is part of & supportedVersions & SUPPORTED_CONTRACT_VERSIONS
 * or any, false otherwise.
 */
function runTestForVersion(supportedVersions, SUPPORTED_CONTRACT_VERSIONS, currentTestIterationVersion) {
  // Validate that the array of supportedVersions provided is in the SUPPORTED_CONTRACT_VERSIONS OR is `any`.
  const supportedVersionOverlap = lodash.intersectionBy(
    supportedVersions,
    [...SUPPORTED_CONTRACT_VERSIONS, { contractType: "any", contractVersion: "any" }],
    version => [version.contractType, version.contractVersion].join(",")
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
    version => [version.contractType, version.contractVersion].join(",")
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
async function createConstructorParamsForContractVersion(
  contractVersion,
  contextObjects,
  overrideConstructorParams = {}
) {
  assert(
    contractVersion && contractVersion.contractVersion && contractVersion.contractType,
    "contractVersion must be provided, containing both a contract version and type"
  );
  const requiredContextObjects = [
    "convertSynthetic",
    "finder",
    "collateralToken",
    "syntheticToken",
    "identifier",
    "fundingRateIdentifier",
    "timer",
    "store",
    "configStore"
  ];

  // Check that each of the expected keys is present and not null.
  requiredContextObjects.forEach(expectedKey => {
    assert(
      contextObjects[expectedKey] && Object.keys(contextObjects).includes(expectedKey),
      `Provided context object is missing type ${expectedKey} or is undefined`
    );
  });

  let constructorParams = {
    expirationTimestamp: (await contextObjects.timer.getCurrentTime()).toNumber() + 100000,
    withdrawalLiveness: "1000",
    collateralAddress: contextObjects.collateralToken.address,
    tokenAddress: contextObjects.syntheticToken.address,
    finderAddress: contextObjects.finder.address,
    priceFeedIdentifier: padRight(utf8ToHex(contextObjects.identifier), 64),
    liquidationLiveness: "1000",
    collateralRequirement: { rawValue: toWei("1.2") },
    disputeBondPercentage: { rawValue: toWei("0.1") },
    sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
    disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
    minSponsorTokens: { rawValue: contextObjects.convertSynthetic("5") },
    timerAddress: contextObjects.timer.address,
    excessTokenBeneficiary: contextObjects.store.address,
    financialProductLibraryAddress: ZERO_ADDRESS
  };

  if (contractVersion.contractVersion == "1.2.2") {
    constructorParams.disputerDisputeRewardPct = constructorParams.disputerDisputeRewardPercentage;
    constructorParams.sponsorDisputeRewardPct = constructorParams.sponsorDisputeRewardPercentage;
    constructorParams.disputeBondPct = constructorParams.disputeBondPercentage;
  }

  if (contractVersion.contractType == "Perpetual") {
    constructorParams.fundingRateIdentifier = padRight(utf8ToHex(contextObjects.fundingRateIdentifier), 64);
    constructorParams.configStoreAddress = contextObjects.configStore.address;
    constructorParams.tokenScaling = { rawValue: toWei("1") };
  }

  return { ...constructorParams, ...overrideConstructorParams };
}

module.exports = {
  runTestForVersion,
  createConstructorParamsForContractVersion,
  SUPPORTED_CONTRACT_VERSIONS,
  TESTED_CONTRACT_VERSIONS
};
