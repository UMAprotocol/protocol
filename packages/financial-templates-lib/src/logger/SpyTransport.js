// This transport enables unit tests to validate values passed to Winston using a Sinon Spy.

const Transport = require("winston-transport");
const argv = require("minimist")(process.argv.slice(), { boolean: ["logInTest"] });

class SpyTransport extends Transport {
  constructor(winstonOptions, spyOptions) {
    super(winstonOptions);
    this.spy = spyOptions.spy; // local instance of the spy to capture passed messages.
  }

  async log(info, callback) {
    // Add an `logInTest` option to help with debugging to bots in tests by printing all logs received by winston.
    if (argv._.includes("logInTest")) console.log(JSON.stringify(info, null, 2));
    // Add info sent to the winston transport to the spy. This enables unit tests to validate what is passed to winston.
    this.spy(info);
    callback();
  }
}

// Helper function used by unit tests to check if the last message sent to winston contains a particular string value.
// Caller feeds in the spy instance and the value to check.
function lastSpyLogIncludes(spy, value) {
  return spyLogIncludes(spy, -1, value);
}

function spyLogIncludes(spy, messageIndex, value) {
  // Sinon's getCall(n) function returns values sent in the nth (zero-indexed) call to the spy. Flatten the whole object
  // and any log messages included and check if the provided value is within the object.
  const lastLogMessage = JSON.stringify([
    spy.getCall(messageIndex).lastArg,
    spy.getCall(messageIndex).lastArg.error ? spy.getCall(messageIndex).lastArg.error.message : "" // If there is an error, add its message.
  ]);
  return lastLogMessage.indexOf(value) !== -1;
}

// Helper function used by unit tests to get the most recent log level.
function lastSpyLogLevel(spy) {
  return spy.getCall(-1).lastArg.level;
}

function spyLogLevel(spy, messageIndex) {
  return spy.getCall(messageIndex).lastArg.level;
}

module.exports = { SpyTransport, lastSpyLogIncludes, spyLogIncludes, lastSpyLogLevel, spyLogLevel };
