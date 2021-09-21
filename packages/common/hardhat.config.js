const { getHardhatConfig } = require("./dist/HardhatConfig");

const path = require("path");
const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));

const configOverride = {
  paths: {
    root: coreWkdir,
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
    tests: "./test",
  },
};

module.exports = getHardhatConfig(configOverride, coreWkdir, false);
