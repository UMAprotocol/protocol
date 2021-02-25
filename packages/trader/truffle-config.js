const path = require("path");
const wkdir = path.dirname(require.resolve("@uma/core/package.json"));

module.exports = require("@uma/common").getTruffleConfig(wkdir);
