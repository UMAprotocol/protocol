const path = require("path");
const wkdir = path.dirname(require.resolve("@uma/core-1-2-0/package.json"));

module.exports = require("@uma/common").getTruffleConfig(wkdir);
