const { getAllFilesInPath } = require("@uma/common");

// This file is mostly taken from the modified `compile` task file written by Synthetix: https://github.com/Synthetixio/synthetix

const { internalTask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");

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

  // Temp work around to exclude some directories from truffle while compiling with hardhat. Pulls in all contracts in
  // the directory `contracts-ovm` to compile with hardhat.
  const corePackagePath = require.resolve("@uma/core/package.json");
  const corePath = corePackagePath.slice(0, corePackagePath.indexOf("package.json"));
  filePaths = [...filePaths, ...getAllFilesInPath(`${corePath}/contracts-ovm`)];

  // Build absolute path for all directories on user-specified whitelist.
  const whitelist = config.networks[network.name].compileWhitelist;
  if (whitelist && Array.isArray(whitelist)) {
    filePaths = filePaths.filter((filePath) => {
      for (let whitelistedDir of whitelist) {
        if (filePath.includes(whitelistedDir)) return true;
        else continue;
      }
      return false;
    });
  }
  return filePaths;
});
