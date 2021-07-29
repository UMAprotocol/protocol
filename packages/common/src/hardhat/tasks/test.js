const path = require("path");
const { internalTask } = require("hardhat/config");
const { TASK_TEST_GET_TEST_FILES } = require("hardhat/builtin-tasks/task-names");

const TESTS_DIR = path.resolve(__dirname, "../../../../core/test");

// This overrides a hardhat internal task, which is part of its test task's lifecycle. This allows us to only run tests
// that are compatible with a given network config, which are desciribed by entries in a hardhat network's
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
    const whitelistDirs = whitelist.map((x) => path.resolve(TESTS_DIR, x));

    filePaths = filePaths.filter((filePath) => {
      for (let whitelistedDir of whitelistDirs) {
        if (!path.resolve(process.cwd(), filePath).startsWith(whitelistedDir)) return false;
        else continue;
      }
      return true;
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
