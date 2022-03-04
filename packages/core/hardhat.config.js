const { getHardhatConfig } = require("@uma/common");

const path = require("path");
const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));
const packageWkdir = path.dirname(require.resolve("@uma/core/package.json"));

let typechain = undefined;
if (process.env.TYPECHAIN === "web3") {
  typechain = { outDir: "contract-types/web3", target: "web3-v1", alwaysGenerateOverloads: false };
} else if (process.env.TYPECHAIN === "ethers") {
  typechain = { outDir: "contract-types/ethers", target: "ethers-v5", alwaysGenerateOverloads: false };
}

if (typechain !== undefined) require("@typechain/hardhat");

const configOverride = {
  paths: {
    root: coreWkdir,
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
    tests: `${packageWkdir}/test`,
  },
  typechain,
};

module.exports = getHardhatConfig(configOverride, __dirname);
