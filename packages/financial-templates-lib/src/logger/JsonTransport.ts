// This transport enables Winston logging to the console in json objects. Used to convert multiple json outputs from one
// execution into an array of json objects used upstream in serverless bots.
import winston from "winston";
const { format } = winston;
const { combine, timestamp, printf } = format;

export function createJsonTransport(): winston.transports.ConsoleTransportInstance {
  return new winston.transports.Console({
    handleExceptions: true,
    format: combine(
      timestamp(),
      printf((info) => {
        if (info.error) {
          // If there is an error then strip out all punctuation to make it easily consumable by GCP within a log json
          // object. Note this error object is assumed to be a string, converted within Logger.js that uses this transport.
          info.error = info.error
            .toString()
            .replace(/\r?\n|\r/g, "")
            .replace(/\s\s+/g, " ") // Remove tabbed chars.
            .replace(/\\"/g, ""); // Remove escaped quotes.
        }
        return JSON.stringify(info);
      })
    ),
  });
}
