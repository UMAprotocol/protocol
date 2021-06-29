const path = require("path");
const { internalTask } = require("hardhat/config");
const { TASK_TEST_GET_TEST_FILES } = require("hardhat/builtin-tasks/task-names");

const TESTS_DIR = path.resolve(__dirname, "../../../../core/test");

// This overrides a hardhat internal task, which is part of its test task's lifecycle.
// This allows us to filter out files from tests that shouldn't be run for a given network,
// which are entries in a hardhat network's `testBlacklist` configuration. For example:
// defaultConfig = {
//     networks: {
//         hardhat: { ..., testBlacklist: ["ovm"] }
//     }
// }
internalTask(TASK_TEST_GET_TEST_FILES, async (_, { config, network }, runSuper) => {
  let filePaths = await runSuper();

  // Build absolute path for all directories on user-specified blacklist.
  const blacklist = config.networks[network.name].testBlacklist;
  if (blacklist && Array.isArray(blacklist)) {
    const blacklistDirs = blacklist.map((x) => {
      return path.resolve(TESTS_DIR, x);
    });

    filePaths = filePaths.filter((filePath) => {
      for (let blacklistedDir of blacklistDirs) {
        return !filePath.startsWith(blacklistedDir);
      }
    });
  }

  return filePaths;
});
