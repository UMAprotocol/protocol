// This transport enables Winston logging to the console in json objects. Used to convert multiple json outputs from one
// execution into an array of json objects used upstream in serverless bots.
const winston = require("winston");
const { format } = winston;
const { combine, timestamp, printf } = format;

function createJsonTransport() {
  return new winston.transports.Console({
    handleExceptions: true,
    format: combine(
      timestamp(),
      printf(info => {
        let { timestamp, level, error, ...args } = info;
        if (error) {
          // If there is an error then strip out all punctuation to make it easily consumable by GCP within a log json
          // object. Note this error object is assumed to be a string, converted within Logger.js that uses this transport.
          error = error
            .toString()
            .replace(/\r?\n|\r/g, "")
            .replace(/\s\s+/g, " ") // Remove tabbed chars.
            .replace(/\\"/g, ""); // Remove escaped quotes.

          info = { timestamp, level, error, ...args };
        }
        return JSON.stringify(info);
      })
    )
  });
}

module.exports = { createJsonTransport };
