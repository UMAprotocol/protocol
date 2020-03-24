// This transport enables Winston logging to the console.
const winston = require("winston");

const alignedWithColorsAndTime = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(info => {
    const { timestamp, level, ...args } = info;

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
