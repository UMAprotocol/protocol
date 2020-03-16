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

const slackFormatter = info => {
  // Each part of the slack response is a separate block with markdown text within it.
  // All slack responses start with the heading level and where the message came from.
  let formattedResponse = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${info.level}: ${info.at}* --> ${info.message}`
        }
      }
    ]
  };

  // All messages from winston come in as a Json object. The loop below expands this object
  //and adds mrkdwn sections for each key value pair with a bullet point. If the section is
  // an object then it was passed containing multiple sub points. This is also expanded as a
  // sub indented section. If the key is `tx` then it is encoded as a etherscan URL.
  for (const key in info) {
    // these keys have been printed in the previous block.
    if (key == "at" || key == "level" || key == "message") {
      continue;
    }
    if (typeof info[key] === "object" && info[key] !== null) {
      formattedResponse.blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: ` • _${key}_:\n`
        }
      });
      for (const subKey in info[key]) {
        if (subKey == "tx") {
          formattedResponse.blocks[
            formattedResponse.blocks.length - 1
          ].text.text += `    - _tx_: <https://etherscan.io/tx/${info[key][subKey]}|${info[key][subKey]}> \n`;
        } else {
          formattedResponse.blocks[
            formattedResponse.blocks.length - 1
          ].text.text += `    - _${subKey}_: ${info[key][subKey]}\n`;
        }
      }
    } else {
      formattedResponse.blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: ` • _${key}_: ${info[key]}`
        }
      });
    }
  }
  return formattedResponse;
};

const transports = [
  new StackTransport({
    level: "error",
    handleExceptions: true
  }),
  new winston.transports.Console({
    handleExceptions: true,
    format: alignedWithColorsAndTime
  })
];

if (process.env.SLACK_WEBHOOK) {
  transports.push(
    new SlackHook({
      level: "info",
      webhookUrl: process.env.SLACK_WEBHOOK,
      formatter: info => {
        return slackFormatter(info);
      }
    })
  );
}

const Logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(winston.format(info => info)(), winston.format.json()),
  transports,
  exitOnError: false
});

module.exports = {
  Logger
};
