const path = require("path");

// This file is mostly taken from the modified `compile` task file written by Synthetix: https://github.com/Synthetixio/synthetix

const { internalTask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");

const CONTRACTS_DIR = path.resolve(__dirname, "../../../../core/contracts");

// This overrides a buidler internal task, which is part of its compile task's lifecycle.
// This allows us to filter on whitelisted, OVM-compatible contracts from the compilation list,
// which are entries in extended `compileWhitelist` configuration.
internalTask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS, async (_, { config, network }, runSuper) => {
  let filePaths = await runSuper();

  // Build absolute path for all directories on user-specified whitelist.
  const whitelist = config.networks[network.name].compileWhitelist;
  const whitelistDirs = whitelist.map((x) => {
    return path.resolve(CONTRACTS_DIR, x);
  });

  if (Array.isArray(whitelist) && whitelist.length > 0) {
    filePaths = filePaths.filter((filePath) => {
      for (let whitelistedDir of whitelistDirs) {
        return filePath.startsWith(whitelistedDir);
      }
    });
  } else {
    throw new Error("'compileWhitelist' should be an array containing directories within core/contracts to compile");
  }

  return filePaths;
});
