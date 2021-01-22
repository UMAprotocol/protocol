const web3 = require("web3");
const { toWei, utf8ToHex, padRight } = web3.utils;

const { ZERO_ADDRESS } = require("./Constants");

// Contract versions used in unit tests to define supported versions.
const SUPPORTED_TEST_CONTRACT_VERSIONS = ["ExpiringMultiParty-1.2.2", "ExpiringMultiParty-latest", "Perpetual-latest"];

// Versions that production bots support.
const SUPPORTED_CONTRACT_VERSIONS = [
  { contractType: "ExpiringMultiParty", contractVersion: "1.2.2" },
  { contractType: "ExpiringMultiParty", contractVersion: "latest" },
  { contractType: "Perpetual", contractVersion: "latest" }
];

function runTestForVersion(supportedVersions, SUPPORTED_CONTRACT_VERSIONS, currentTestIterationVersion) {
  // Validate that the array of supportedVersions provided is in the SUPPORTED_CONTRACT_VERSIONS OR is `any`.
  let totalVersionOverlaps = 0;
  let totalSupportedVersionOverlap = 0;
  supportedVersions.forEach(supportedVersion => {
    totalVersionOverlaps += [...SUPPORTED_CONTRACT_VERSIONS, { contractType: "any", contractVersion: "any" }].filter(
      versionObject =>
        versionObject.contractType == supportedVersion.contractType &&
        versionObject.contractVersion == supportedVersion.contractVersion
    ).length;
    totalSupportedVersionOverlap +=
      supportedVersion.contractType == currentTestIterationVersion.contractType &&
      supportedVersion.contractVersion == currentTestIterationVersion.contractVersion;
    totalSupportedVersionOverlap += supportedVersion.contractType == "any" && supportedVersion.contractVersion == "any";
  });
  if (totalVersionOverlaps == 0)
    throw new Error(
      `Contract version specified or inferred is not supported. Loaded/inferred contractVersion:${
        supportedVersions.contractVersion
      } & contractType:${supportedVersions.contractType} is not part of ${JSON.stringify(SUPPORTED_CONTRACT_VERSIONS)}`
    );
  return totalSupportedVersionOverlap > 0;
}

async function createConstructorParamsForContractVersion(
  web3,
  contractVersion,
  contractType,
  contextObjects,
  overrideConstructorParams = {}
) {
  assert(web3, "Web3 object must be provided");
  assert(contractVersion, "contractVersion must be provided");
  assert(contractType, "contractVersion must be provided");
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
    assert.isTrue(
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
    minSponsorTokens: { rawValue: contextObjects.convertSynthetic("1") },
    timerAddress: contextObjects.timer.address,
    excessTokenBeneficiary: contextObjects.store.address,
    financialProductLibraryAddress: ZERO_ADDRESS
  };

  if (contractVersion == "1.2.2") {
    constructorParams.disputerDisputeRewardPct = constructorParams.disputerDisputeRewardPercentage;
    constructorParams.sponsorDisputeRewardPct = constructorParams.sponsorDisputeRewardPercentage;
    constructorParams.disputeBondPct = constructorParams.disputeBondPercentage;
  }

  if (contractType == "Perpetual") {
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
  SUPPORTED_TEST_CONTRACT_VERSIONS
};
