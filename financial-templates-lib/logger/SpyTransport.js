// This transport enables unit tests to validate values passed Winston using a Sinon Spy.

const Transport = require("winston-transport");

class SpyTransport extends Transport {
  constructor(winstonOptions, spyOptions) {
    super(winstonOptions);
    this.spy = spyOptions.spy; // local instance of the spy to capture passed messages.
  }

  async log(info, callback) {
    // Add info sent to the winston transport to the spy. This enables unit tests to validate what is passed to winston.
    this.spy(info);
    callback();
  }
}

// Helper function used by unit tests to check if the last message sent to winston contains a particular string value.
// Caller feeds in the spy instance and the value to check.
const lastSpyLogIncludes = (spy, value) => {
  // Sinon's getCall(n) function returns the values sent in in the nth call the the spy
  const lastReturnedArg = spy.getCall(-1).lastArg.mrkdwn.toString();
  return lastReturnedArg.indexOf(value) != -1;
};

module.exports = { SpyTransport, lastSpyLogIncludes };
