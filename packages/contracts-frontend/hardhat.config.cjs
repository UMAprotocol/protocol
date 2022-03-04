const { getHardhatConfig } = require("@uma/common");

const path = require("path");
const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));
const configOverride = {
  paths: {
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
  },
};

module.exports = getHardhatConfig(configOverride, __dirname);
