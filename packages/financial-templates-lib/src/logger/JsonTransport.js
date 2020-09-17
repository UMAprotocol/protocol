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
          // If there is an error then convert it from a Javascript error object into a json object. Json.stringify is
          // used to remove the javascript error notation with message and sack and convert it to a key-value paired object.
          error = JSON.parse(
            JSON.stringify(
              error
                .replace(/\r?\n|\r/g, "")
                .replace(/\s\s+/g, " ") // Remove tabbed chars.
                .replace(/\\"/g, ""), // Remove escaped quotes.
              Object.getOwnPropertyNames(error) // Turn the json object into a parsable structure.
            )
          );

          info = { timestamp, level, error, ...args };
        }
        return JSON.stringify(info);
      })
    )
  });
}

module.exports = { createJsonTransport };
