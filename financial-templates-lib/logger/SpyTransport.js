// This transport enables unit tests to validate values passed to Winston using a Sinon Spy.

const Transport = require("winston-transport");
const argv = require("minimist")(process.argv.slice(), {});

class SpyTransport extends Transport {
  constructor(winstonOptions, spyOptions) {
    super(winstonOptions);
    this.spy = spyOptions.spy; // local instance of the spy to capture passed messages.
  }

  async log(info, callback) {
    if (argv._.indexOf("logInTest") == -1) console.log("info", info);
    // Add info sent to the winston transport to the spy. This enables unit tests to validate what is passed to winston.
    this.spy(info);
    callback();
  }
}

// Helper function used by unit tests to check if the last message sent to winston contains a particular string value.
// Caller feeds in the spy instance and the value to check.
function lastSpyLogIncludes(spy, value) {
  // Sinon's getCall(n) function returns values sent in the nth (zero-indexed) call to the spy. Check both the mrkdown and message sent.
  const lastReturnedArgMrkdwn = spy.getCall(-1).lastArg.mrkdwn.toString();
  const lastReturnedArgMessage = spy.getCall(-1).lastArg.message.toString();
  return lastReturnedArgMrkdwn.indexOf(value) !== -1 || lastReturnedArgMessage.indexOf(value) !== -1;
}

function spyLogIncludes(spy, messageIndex, value) {
  // Sinon's getCall(n) function returns values sent in the nth (zero-indexed) call to the spy.
  return (
    spy
      .getCall(messageIndex)
      .lastArg.message.toString()
      .indexOf(value) !== -1
  );
}

// Helper function used by unit tests to get the most recent log level.
function lastSpyLogLevel(spy) {
  return spy.getCall(-1).lastArg.level.toString();
}

function spyLogLevel(spy, messageIndex) {
  return spy.getCall(messageIndex).lastArg.level.toString();
}

module.exports = { SpyTransport, lastSpyLogIncludes, spyLogIncludes, lastSpyLogLevel, spyLogLevel };
