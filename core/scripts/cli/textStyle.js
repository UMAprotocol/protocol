const chalkPipe = require("chalk-pipe");
const ora = require("ora");
const moment = require("moment");

// General library for displaying text in terminal in (enjoyable) human readable form
module.exports = {
  // Colors
  instruction: chalkPipe("bgRed"),
  success: chalkPipe("bgGreen"),
  help: chalkPipe("bgCyan"),

  // Links
  link: chalkPipe("blue.underline"),

  // Spinners
  spinnerReadingContracts: ora({
    text: "Reading contracts",
    color: "blue"
  }),
  spinnerWritingContracts: ora({
    text: "Submitting contract transactions",
    color: "red"
  }),

  // Date format
  formatSecondsToUtc: timestampInSeconds => {
    return moment.utc(timestampInSeconds * 1000).format("MMMM Do YYYY, h:mm:ss a");
  }
};
