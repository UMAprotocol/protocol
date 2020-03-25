// This transport enables Winston logging to the console.
const winston = require("winston");

const alignedWithColorsAndTime = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(info => {
    const { timestamp, level, ...args } = info;

    // This slice changes a timestamp formatting from `2020-03-25T10:50:57.168Z` -> `2020-03-25 10:50:57`
    const ts = timestamp.slice(0, 19).replace("T", " ");
    return `${ts} [${level}]: ${Object.keys(args).length ? JSON.stringify(args, null, 2) : ""}`;
  })
);

function createConsoleTransport() {
  return new winston.transports.Console({
    handleExceptions: true,
    format: alignedWithColorsAndTime
  });
}

module.exports = { createConsoleTransport };
