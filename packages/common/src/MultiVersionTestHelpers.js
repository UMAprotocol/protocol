// const versionedIt = function(supportedVersions, shouldBeItOnly = false) {
//   if (shouldBeItOnly) return runTestForContractVersion(supportedVersions) ? it.only : () => {};
//   return runTestForContractVersion(supportedVersions) ? it : () => {};
// };

// const runTestForContractVersion = function(supportedVersions) {
//   // Validate that the array of supportedVersions provided is in the SUPPORTED_CONTRACT_VERSIONS OR is any.
//   // if ([...SUPPORTED_CONTRACT_VERSIONS, "any"].filter(value => supportedVersions.includes(value)).length == 0) {
//   //   throw new Error(
//   //     `Contract versioned specified ${supportedVersions} is not part of the supported contracts for this test suit`
//   //   );
//   // }
//   // Return if the `currentTestIterationVersion` is part of the supported versions includes any. Returning true
//   // means that test will be run. Else, if returned false, the test will be skipped.
//   return supportedVersions.includes(currentTestIterationVersion) || supportedVersions.includes("any");
// };

// module.exports = {
//   findContractVersion
// };
