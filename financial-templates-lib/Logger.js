// The logger has a number of different levels based on the severity of the incident:
//-> Debugs: self explanatory. Normal status-based logging. These can trigger
//   every iteration. Unlimited volume.
//-> Info: when something happens that is notable, but not necessarily actionable.
//   These should not trigger every iteration. Any on-chain event that executed correctly.
//   these trigger a slack message that everyone has access to.
//-> Error: anything that requires human intervention. If the bot is low on funds or a
//   transaction fails(some txn failures are sporadic and normal, but it may be difficult
//   to distinguish).These can trigger every iteration, but only if it's because the bot
//   encounters a persistent issue that requires human intervention to solve.Trigger a DM
//   to oncall, text / call to oncall, and publish to a slack channel that nobody has muted
//   (or just use @channel to force a notif).

// calling debug/info/error logging requires an specificity formatted json object as a param for the logger.
// All objects must have an `at`, `message` as a minimum to describe where the error was logged from
// and what has occurred. Any addition key value pairing can be attached, including json objects which
// will be spread. A transaction should be within an object that contains a `tx` key containing the mined
// transaction hash. See `liquidator.js` for an example. An example object is shown below:

// Logger.error({
//   at: "liquidator",
//   message: "failed to withdraw rewards from liquidation",
//   address: liquidation.sponsor,
//   id: liquidation.id
// });

// Note that this also requires the configuration of a slack webhook. Add this to your .env
// see https://slack.com/intl/en-za/help/articles/115005265063-Incoming-Webhooks-for-Slack

//TODO: implement phone calls from slack bot.

const winston = require("winston");
const Transport = require("winston-transport");
const SlackHook = require("winston-slack-webhook-transport");
const TwilioTransport = require("./TwilioTransport");
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
  if (!("level" in info) || !("at" in info) || !("message" in info)) {
    console.error("WINSTON INCORRECTLY CONFIGURED IN MESSAGE", info);
    return {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*incorrectly formatted winston message!*`
          }
        }
      ]
    };
  }

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
      // If the value in the message is an object then spread each key value pair within the object.
      formattedResponse.blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: ` • _${key}_:\n`
        }
      });
      for (const subKey in info[key]) {
        // for each key value pair within the object, spread.
        // Note that only a transaction can come at this level. This is because a transaction is always
        // an object with the event emmited included in the object.
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
      // If the value in the message object is an string or a integer then show it as _key: value
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

// If there is a slack web hook, add the transport
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

// If all the required environment variables for twilio are added, add the transport
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH && process.env.DRI_NUMBER1 && process.env.TWILIO_FROM_NUMBER) {
  // note that twilio will only report on error. levels
  transports.push(new TwilioTransport({ level: "error" }));
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
