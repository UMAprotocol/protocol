const winston = require("winston");
const Transport = require("winston-transport");
const SlackHook = require("winston-slack-webhook-transport");
require("dotenv").config();

class StackTransport extends Transport {
  log(info, callback) {
    setImmediate(() => {
      if (info && info.error) {
        // eslint-disable-next-line
        console.error(info.error.stack);
      }
    });
    if (callback) {
      callback();
    }
  }
}

const alignedWithColorsAndTime = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(info => {
    const { timestamp, level, ...args } = info;

    const ts = timestamp.slice(0, 19).replace("T", " ");
    return `${ts} [${level}]: ${Object.keys(args).length ? JSON.stringify(args, null, 2) : ""}`;
  })
);

const transports = [
  new StackTransport({
    level: "error",
    handleExceptions: true
  })
];

if (process.env.SLACK_WEBHOOK) {
  transports.push(
    new SlackHook({
      webhookUrl: process.env.SLACK_WEBHOOK,
      formatter: info => {
        return {
          text: `${info.level}: ${info.message}`,
          attachments: [
            {
              text: `${JSON.stringify(info)}`
            }
          ],
          blocks: [
            {
              type: "section",
              text: {
                type: "plain_text",
                text: `${info.level}`
              }
            }
          ]
        };
      }
    })
  );
}

transports.push(
  new winston.transports.Console({
    level: "debug",
    handleExceptions: true
    // format: alignedWithColorsAndTime
  })
);

const Logger = winston.createLogger({
  format: winston.format.combine(winston.format(info => info)(), winston.format.json()),
  transports,
  exitOnError: false
});

module.exports = {
  Logger
};
