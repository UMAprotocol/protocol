// Custom winston transport to capture logs produced. Used by the strategy runner to get back execution outputs.

import Transport = require("winston-transport");

class logCaptureTransport extends Transport {
  logStorage: any;
  constructor(opts: any, logStorage: Array<any>) {
    super(opts);
    this.logStorage = logStorage;
  }
  async log(info: any, callback: any) {
    try {
      // eslint-disable-next-line prefer-const
      let { timestamp, level, error, ...args } = info;
      if (error) {
        error = error // If there is an error then strip out all punctuation to make it easily consumable.
          .toString()
          .replace(/\r?\n|\r/g, "")
          .replace(/\s\s+/g, " ") // Remove tabbed chars.
          .replace(/\\"/g, ""); // Remove escaped quotes.

        info = { timestamp, level, error, ...args };
      }
      this.logStorage.push(info);
      callback();
    } catch (error) {
      this.emit("error", error);
    }
  }
}

export default logCaptureTransport;
