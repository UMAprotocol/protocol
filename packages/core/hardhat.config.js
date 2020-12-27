const { getHardhatConfig } = require("@uma/common");

const path = require("path");
const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));
const packageWkdir = path.dirname(require.resolve("@uma/core/package.json"));

const configOverride = {
  paths: {
    root: coreWkdir,
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
    tests: `${packageWkdir}/test`
  }
};

// `getHardhatConfig` has a `configOverrides` parameter, but we can't use it
// since it does a shallow merge and we want to override a single nested field.
const config = getHardhatConfig(configOverride);

// The default is 199. FiXME - comment out this line to see what goes wrong:
config.solidity.settings.optimizer.runs = 25;

module.exports = config;
