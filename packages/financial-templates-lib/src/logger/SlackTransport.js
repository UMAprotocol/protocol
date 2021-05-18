// This transport enables slack messages to be sent from Winston logging. To configure this
// create a slack webhook and add this to your .env file. a sample in .env_sample shows this.
// see https://slack.com/intl/en-za/help/articles/115005265063-Incoming-Webhooks-for-Slack for more.

// This formatter assumes one of two kinds of inputs:
// 1) A pre-formatted markdown message with a key value named `mrkdwn`. These messages come from bots that have strict
//    formatting rules around how text should be formatted. An example Winston log:
//    this.logger.warn({
//      at: "ContractMonitor",
//      message: "Collateralization ratio alert 🙅‍♂️!",
//      mrkdwn: *This is a markdown* formatted String With markdown syntax.});
//    In this type the transport simply sends the markdown text to the slack webhook.
// 2) A log message can also contain javascript strings, numbers, and even objects. In this case the transport will
//    spread out the content within the log message. Nested objects are also printed. An example Winston log:
//    this.logger.info({
//      at: "Liquidator",
//      message: "Liquidation withdrawn🤑",
//      liquidation: liquidation,
//      amount: withdrawAmount.rawValue,
//      txnConfig,
//      liquidationResult: logResult});
//    In this log the liquidation and txnConfig are objects. these are spread as nested bullet points in the slack message.
//    The amount is a string value. This is shown as a bullet point item.
const Transport = require("winston-transport");
const axios = require("axios").default;
const { createEtherscanLinkMarkdown } = require("@uma/common");

function slackFormatter(info) {
  try {
    if (!("level" in info) || !("at" in info) || !("message" in info))
      throw new Error("WINSTON MESSAGE INCORRECTLY CONFIGURED");

    // Each part of the slack response is a separate block with markdown text within it.
    // All slack responses start with the heading level and where the message came from.
    let formattedResponse = {
      // If the bot contains an identifier flag it should be included in the heading.
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `[${info.level}] *${info["bot-identifier"]}* (${info.at})⭢${info.message}\n`,
          },
        },
      ],
    };
    // All messages from winston come in as a Json object. The loop below expands this object and adds mrkdwn sections
    // for each key value pair with a bullet point. If the section is an object then it was passed containing multiple
    // sub points. This is also expanded as a sub indented section.
    for (const key in info) {
      // these keys have been printed in the previous block.
      if (key == "at" || key == "level" || key == "message" || key == "bot-identifier") {
        continue;
      }
      // If the key is `mrkdwn` then simply return only the markdown as the txt object. This assumes all formatting has
      // been applied in the bot itself. For example the monitor bots which conform to strict formatting rules.
      if (key == "mrkdwn") {
        formattedResponse.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: ` ${info[key]}`,
          },
        });
      }
      // If the value in the message is an object then spread each key value pair within the object.
      else if (typeof info[key] === "object" && info[key] !== null) {
        formattedResponse.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: ` • _${key}_:\n`,
          },
        });
        // For each key value pair within the object, spread the object out for formatting.
        for (const subKey in info[key]) {
          // If the length of the value is 66 then we know this is a transaction hash. Format accordingly.
          if (info[key][subKey].length == 66) {
            formattedResponse.blocks[
              formattedResponse.blocks.length - 1
            ].text.text += `    - _tx_: ${createEtherscanLinkMarkdown(info[key][subKey])}\n`;
          }
          // If the length of the value is 42 then we know this is an address. Format accordingly.
          else if (info[key][subKey].length == 42) {
            formattedResponse.blocks[
              formattedResponse.blocks.length - 1
            ].text.text += `    - _${subKey}_: ${createEtherscanLinkMarkdown(info[key][subKey])}\n`;
          }
          // If the value within the object itself is an object we dont want to spread it any further. Rather,
          // convert the object to a string and print it along side it's key value pair.
          else if (typeof info[key][subKey] === "object" && info[key][subKey] !== null) {
            formattedResponse.blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `    - _${subKey}_: ${JSON.stringify(info[key][subKey])}\n`,
              },
            });
            // Else if not a address, transaction or object then print as ` - key: value`
          } else {
            formattedResponse.blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `    - _${subKey}_: ${info[key][subKey]}\n`,
              },
            });
          }
        }
        // Else, if the input is not an object then print the values as key value pairs. First check for addresses or txs
      } else if (info[key]) {
        // like with the previous level, if there is a value that is a transaction or an address format accordingly
        if (info[key].length == 66) {
          formattedResponse.blocks[
            formattedResponse.blocks.length - 1
          ].text.text += ` • _tx_: ${createEtherscanLinkMarkdown(info[key])}\n`;
        }
        // If the length of the value is 42 then we know this is an address. Format accordingly.
        else if (info[key].length == 42) {
          formattedResponse.blocks[
            formattedResponse.blocks.length - 1
          ].text.text += ` • _${key}_: ${createEtherscanLinkMarkdown(info[key])}\n`;
        } else {
          formattedResponse.blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: ` • _${key}_: ${info[key]}\n`,
            },
          });
        }
        // Else, if the value from the key value pair is null still show the key in the log. For example if a param is
        // logged but empty we still want to see the key.
      } else if (info[key] == null) {
        formattedResponse.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: ` • _${key}_: null`,
          },
        });
      }
    }
    // Add a divider to the end of the message to help distinguish messages in long lists.
    formattedResponse.blocks.push({
      type: "divider",
    });
    return formattedResponse;
  } catch (error) {
    return {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Something went wrong in the winston formatter!*\n\nError:${error}\n\nlogInfo:${JSON.stringify(
              info
            )}`,
          },
        },
      ],
    };
  }
}

class SlackHook extends Transport {
  constructor(opts) {
    super(opts);
    opts = opts || {};
    this.name = opts.name || "slackWebhook";
    this.level = opts.level || undefined;
    this.webhookUrl = opts.webhookUrl;
    this.formatter = opts.formatter || undefined;
    this.mrkdwn = opts.mrkdwn || false;

    this.axiosInstance = axios.create({ proxy: opts.proxy || undefined });
  }

  async log(info, callback) {
    let payload = {
      mrkdwn: this.mrkdwn,
    };

    let layout = this.formatter(info);
    payload.text = layout.text || undefined;
    payload.attachments = layout.attachments || undefined;
    payload.blocks = layout.blocks || undefined;
    let errorThrown = false;
    // If the overall payload is less than 3000 chars then we can send it all in one go to the slack API.
    if (JSON.stringify(payload).length < 3000) {
      let response = await this.axiosInstance.post(this.webhookUrl, payload);
      if (response.status != 200) errorThrown = true;
    } else {
      // If it's more than 3000 chars then we need to split the message sent to slack API into multiple calls.
      let messageIndex = 0;
      let processedBlocks = [[]];
      for (let block of payload.blocks) {
        if (JSON.stringify(block).length > 3000) {
          // If the block (one single part of a message) is larger than 3000 chars then we must redact part of the message.
          const stringifiedBlock = JSON.stringify(block);
          const redactedBlock =
            stringifiedBlock.substr(0, 1400) +
            "-MESSAGE REDACTED DUE TO LENGTH-" +
            stringifiedBlock.substr(stringifiedBlock.length - 1400, stringifiedBlock.length);
          block = JSON.parse(redactedBlock);
        }
        if (JSON.stringify([...processedBlocks[messageIndex], block]).length > 3000) {
          // If the set blocks is larger than 3000 then we must increment the message index, to enable sending the set
          // of messages over multiple calls to the slack API. The amounts to splitting up one Winston log into multiple
          // slack messages with no single slack message exceeding the 3000 char limit.
          messageIndex += 1;
        }
        if (!processedBlocks[messageIndex]) processedBlocks[messageIndex] = [];
        processedBlocks[messageIndex].push(block);
      }
      // Iterate over each message to send and generate a axios call for each message.
      for (const processedBlock of processedBlocks) {
        payload.blocks = processedBlock;
        let response = await this.axiosInstance.post(this.webhookUrl, payload);
        if (response.status != 200) errorThrown = true;
      }
    }
    callback();
    if (errorThrown) console.error("slack transport error!");
  }
}

function createSlackTransport(webHookUrl) {
  return new SlackHook({
    level: "info",
    webhookUrl: webHookUrl,
    formatter: (info) => {
      return slackFormatter(info);
    },
  });
}

module.exports = { createSlackTransport, SlackHook };
