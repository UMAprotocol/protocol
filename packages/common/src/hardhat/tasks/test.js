const { internalTask } = require("hardhat/config");
const { TASK_TEST_GET_TEST_FILES } = require("hardhat/builtin-tasks/task-names");

// This overrides a hardhat internal task, which is part of its test task's lifecycle. This allows us to only run tests
// that are compatible with a given network config, which are described by entries in a hardhat network's
// `testWhitelist`  & `testBlacklist` configuration. For example:
// defaultConfig = {
//     networks: {
//         hardhat: { ..., testWhitelist: ["ovm"], testBlacklist: [".e2e.js"] }
//     }
// }
internalTask(TASK_TEST_GET_TEST_FILES, async (_, { config, network }, runSuper) => {
  let filePaths = await runSuper();

  // Build absolute path for all directories on user-specified whitelist.
  const whitelist = config.networks[network.name].testWhitelist;
  if (whitelist && Array.isArray(whitelist)) {
    filePaths = filePaths.filter((filePath) => {
      for (let whitelistString of whitelist) {
        if (filePath.includes(whitelistString)) return true;
        else continue;
      }
      return false;
    });
  }

  // Some tests should not be run using hardhat. Define a `testBlacklist`. Ignore any tests that contain the blacklist.
  const blacklist = config.networks[network.name].testBlacklist;
  if (blacklist && Array.isArray(blacklist)) {
    filePaths = filePaths.filter((filePath) => {
      for (let blacklistedString of blacklist) {
        if (filePath.includes(blacklistedString)) return false;
        else continue;
      }
      return true;
    });
  }

  return filePaths;
});
