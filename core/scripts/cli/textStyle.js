const chalkPipe = require("chalk-pipe");
const ora = require("ora");

module.exports = {
  bgRed: chalkPipe("bgRed"),
  bgGreen: chalkPipe("bgGreen"),
  bgYellow: chalkPipe("bgYellow"),
  bgCyan: chalkPipe("bgCyan"),
  spinnerReadingContracts: ora({
    text: "Reading contracts",
    color: "blue"
  })
};
