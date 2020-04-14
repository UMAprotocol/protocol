const Transport = require("winston-transport");

module.exports = class SpyTransport extends Transport {
  constructor(winstonOptions, spyOptions) {
    super(winstonOptions);
    this.spy = spyOptions.spy;
  }

  async log(info, callback) {
    console.log("SPY CALLED!", info);
    this.spy(info);
    callback();
  }
};
