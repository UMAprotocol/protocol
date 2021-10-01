const replace = require("@rollup/plugin-replace");
const envType = process.env.ENV_TYPE;

module.exports = {
  rollup(config) {
    // removes the esm prefix -> that just makes importing the module more difficult
    config.output.file = config.output.file.replace(".esm", "");

    if (envType == "web")
      // unshift so that this plugin gets run first
      config.plugins.unshift(
        replace({
          "@uma/contracts-node": "@uma/contracts-frontend",
          // its important to have this, otherwise string wont be replaced
          delimiters: ["", ""],
        })
      );
    return config;
  },
};
