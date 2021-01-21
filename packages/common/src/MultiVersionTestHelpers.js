const web3 = require("web3");
const { toWei, utf8ToHex, padRight } = web3.utils;

const { ZERO_ADDRESS } = require("./Constants");

function testExporter(thisImported) {
  console.log("this", thisImported);
}

function versionedIt(supportedVersions, shouldBeItOnly = false) {
  if (shouldBeItOnly) return runTestForVersion(supportedVersions) ? it.only : () => {};
  return runTestForVersion(supportedVersions) ? it : () => {};
}

function runTestForVersion(supportedVersions, SUPPORTED_CONTRACT_VERSIONS, currentTestIterationVersion) {
  // Validate that the array of supportedVersions provided is in the SUPPORTED_CONTRACT_VERSIONS OR is `any`.
  if ([...SUPPORTED_CONTRACT_VERSIONS, "any"].filter(value => supportedVersions.includes(value)).length == 0) {
    throw new Error(
      `Contract versioned specified ${supportedVersions} is not part of the supported contracts for this test suit`
    );
  }
  // Return if the `currentTestIterationVersion` is part of the supported versions includes any. Returning true
  // means that test will be run. Else, if returned false, the test will be skipped.
  return supportedVersions.includes(currentTestIterationVersion) || supportedVersions.includes("any");
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
    minSponsorTokens: { rawValue: contextObjects.convertSynthetic("5") },
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
  testExporter,
  versionedIt,
  runTestForVersion,
  createConstructorParamsForContractVersion
};
