import path from "path";

// This file is mostly taken from the modified `compile` task file written by Synthetix: https://github.com/Synthetixio/synthetix

import { internalTask } from "hardhat/config";
import type { HttpNetworkConfig } from "hardhat/types";
import { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from "hardhat/builtin-tasks/task-names";

const CONTRACTS_DIR = path.resolve(__dirname, "../../../../core/contracts");

interface ExtendedConfig extends HttpNetworkConfig {
  compileWhitelist?: string[];
}

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
  const whitelist = (config.networks[network.name] as ExtendedConfig).compileWhitelist;
  if (whitelist && Array.isArray(whitelist)) {
    const whitelistDirs = whitelist.map((x) => {
      return path.resolve(CONTRACTS_DIR, x);
    });

    filePaths = filePaths.filter((filePath: string) => {
      for (const whitelistedDir of whitelistDirs) {
        if (filePath.startsWith(whitelistedDir)) return true;
        else continue;
      }
      return false;
    });
  }

  return filePaths;
});
