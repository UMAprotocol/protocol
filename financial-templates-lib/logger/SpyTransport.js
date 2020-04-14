const util = require("util");
const winston = require("winston");

spyLogger = function(options) {
  options = options || {};
  this.level = options.level || "info";
  this.spy = options.spy;
};

util.inherits(spyLogger, winston.Transport);

spyLogger.prototype.name = "spyLogger";

spyLogger.prototype.log = function(level, msg, meta, callback) {
  this.spy(level, msg, meta);
  callback(null, true);
};

module.exports = winston.transports.SpyLogger = spyLogger;
