// This transport enables Winston logging to the console.
const winston = require("winston");
const { format } = winston;
const { combine, timestamp, printf } = format;

function createJsonTransport() {
  return new winston.transports.Console({
    handleExceptions: true,
    format: combine(
      timestamp(),
      printf(info => {
        return JSON.stringify(info);
      })
    )
  });
}

module.exports = { createJsonTransport };
