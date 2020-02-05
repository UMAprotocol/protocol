const chalkPipe = require("chalk-pipe");
const ora = require("ora");
const moment = require('moment');

// General library for displaying text in terminal in (enjoyable) human readable form
module.exports = {
  // Colors
  bgRed: chalkPipe("bgRed"),
  bgGreen: chalkPipe("bgGreen"),
  bgMagenta: chalkPipe("bgMagenta"),
  bgYellow: chalkPipe("bgYellow"),
  bgCyan: chalkPipe("bgCyan"),

  // Spinners
  spinnerReadingContracts: ora({
    text: "Reading contracts",
    color: "blue"
  }),

  // Date format
  formatSecondsToUtc: (timestampInSeconds) => {
    return moment.utc(timestampInSeconds*1000).format('MMMM Do YYYY, h:mm:ss a')
  }  
};
