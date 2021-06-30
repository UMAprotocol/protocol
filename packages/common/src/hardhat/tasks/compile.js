const path = require("path");

// This file is mostly taken from the modified `compile` task file written by Synthetix: https://github.com/Synthetixio/synthetix

const { internalTask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");

const CONTRACTS_DIR = path.resolve(__dirname, "../../../../core/contracts");

// This overrides a hardhat internal task, which is part of its compile task's lifecycle.
// This allows us to filter on whitelisted, OVM-compatible contracts from the compilation list,
// which are entries in a hardhat network's `compileWhitelist` configuration. For example:
// defaultConfig = {
//     networks: {
//         optimism: { ..., compileWhitelist: ["ovm"] }
//     }
// }
internalTask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS, async (_, { config, network }, runSuper) => {
  let filePaths = await runSuper();

  // Build absolute path for all directories on user-specified whitelist.
  const whitelist = config.networks[network.name].compileWhitelist;
  if (whitelist && Array.isArray(whitelist)) {
    const whitelistDirs = whitelist.map((x) => {
      return path.resolve(CONTRACTS_DIR, x);
    });

    filePaths = filePaths.filter((filePath) => {
      for (let whitelistedDir of whitelistDirs) {
        if (filePath.startsWith(whitelistedDir)) return true;
        else continue;
      }
      return false;
    });
  }

  return filePaths;
});
