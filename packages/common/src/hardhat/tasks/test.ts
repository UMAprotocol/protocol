import { internalTask } from "hardhat/config";
import type { HttpNetworkConfig } from "hardhat/types";
import { TASK_TEST_GET_TEST_FILES } from "hardhat/builtin-tasks/task-names";

interface ExtendedNetworkConfig extends HttpNetworkConfig {
  testBlacklist?: string[];
  testWhitelist?: string[];
}

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

  const networkConfig = config.networks[network.name] as ExtendedNetworkConfig; // Cast to allow extra props.

  // Build absolute path for all directories on user-specified whitelist.
  const whitelist = networkConfig.testWhitelist;
  if (whitelist && Array.isArray(whitelist)) {
    filePaths = filePaths.filter((filePath: string) => {
      for (const whitelistString of whitelist) {
        if (filePath.includes(whitelistString)) return true;
        else continue;
      }
      return false;
    });
  }

  // Some tests should not be run using hardhat. Define a `testBlacklist`. Ignore any tests that contain the blacklist.
  const blacklist = networkConfig.testBlacklist;
  if (blacklist && Array.isArray(blacklist)) {
    filePaths = filePaths.filter((filePath: string) => {
      for (const blacklistedString of blacklist) {
        if (filePath.includes(blacklistedString)) return false;
        else continue;
      }
      return true;
    });
  }

  return filePaths;
});
