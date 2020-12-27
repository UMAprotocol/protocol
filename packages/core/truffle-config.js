const config = require("@uma/common").getTruffleConfig(__dirname);

// The default is 199. FiXME - comment out this line to see what goes wrong:
config.compilers.solc.settings.optimizer.runs = 25;

module.exports = config;
