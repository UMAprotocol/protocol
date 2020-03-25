// This transport enables winston logging to a twilio caller bot.

const Transport = require("winston-transport");
const { RoboCaller } = require("./RoboCaller");

module.exports = class TwilioTransport extends Transport {
  constructor(winstonOpts, roboCallerOpts) {
    super(winstonOpts);
    this.roboCaller = new RoboCaller(roboCallerOpts);
  }

  async log(info, callback) {
    // place the call with the given message.
    await this.roboCaller.placeCall(`Error reported from ${info.at} with message ${info.message}`);
    callback();
  }
};
