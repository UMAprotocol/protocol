import { getHardhatConfig } from "@uma/common";
import path from "path";

// Hardhat plugins used in monitor-v2 package tests.
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";

const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));
const packageWkdir = path.dirname(require.resolve("./package.json"));

const configOverride = {
  paths: {
    root: coreWkdir,
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
    tests: `${packageWkdir}/test`,
  },
};

export default getHardhatConfig(configOverride, coreWkdir);
