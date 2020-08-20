const path = require("path");
const wkdir = path.dirname(require.resolve("@umaprotocol/core/package.json"));

module.exports = require("@umaprotocol/common").getTruffleConfig(wkdir);
