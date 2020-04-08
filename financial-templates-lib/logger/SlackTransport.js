// This transport enables slack messages to be sent from Winston logging. To configure this
// create a slack webhook and add this to your .env file. a sample in .env_sample shows this.
// see https://slack.com/intl/en-za/help/articles/115005265063-Incoming-Webhooks-for-Slack for more.

const SlackHook = require("winston-slack-webhook-transport");

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
          text: `*${info.level}: ${info.at}* ⭢ ${info.message}`
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
      // if the key is a transaction object, generate a transaction link
      if (key == "tx") {
        formattedResponse.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: ` • _tx_: <https://etherscan.io/tx/${info[key]}|${info[key]}> \n`
          }
        });
      } else if (key == "markwn") {
        formattedResponse.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: ` ${info[key]}`
          }
        });
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
  }
  return formattedResponse;
};

function createSlackTransport(webHookUrl) {
  return new SlackHook({
    level: "info",
    webhookUrl: webHookUrl,
    formatter: info => {
      return slackFormatter(info);
    }
  });
}

module.exports = { createSlackTransport };
