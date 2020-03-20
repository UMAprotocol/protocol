const Transport = require("winston-transport");
const { RoboCaller } = require("./Robo-Caller");

module.exports = class TwilioTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.RoboCaller = new RoboCaller();
  }

  async log(info, callback) {
    // place the call with the given message.
    await this.RoboCaller.placeCall(`Error reported from ${info.at} with message ${info.message}`);
    callback();
  }
};
