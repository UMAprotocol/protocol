const chalkPipe = require("chalk-pipe");
const ora = require("ora");
const moment = require("moment");

// General library for displaying text and graphics in terminal in (enjoyable) human readable form.
// Used to standardize text styles across the CLI
const style = {
  // Colors
  instruction: chalkPipe("bgRed"),
  success: chalkPipe("bgGreen"),
  warning: chalkPipe("bgYellow"),
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

module.exports = style;
