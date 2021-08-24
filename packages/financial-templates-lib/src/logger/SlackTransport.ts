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
import Transport from "winston-transport";
import axios from "axios";
import type { AxiosInstance, AxiosRequestConfig } from "axios";
import { createEtherscanLinkMarkdown, getWeb3 } from "@uma/common";

interface MarkdownText {
  type: "mrkdwn";
  text: string;
}

type Text = MarkdownText; // Add more | types here to add other types of text.

interface SectionBlock {
  type: "section";
  text: Text;
}

interface DividerBlock {
  type: "divider";
}

type Block = SectionBlock | DividerBlock; // Add more | types here to add more types of blocks.

interface SlackFormatterResponse {
  blocks: Block[];
}
// Note: info is any because it comes directly from winston.
function slackFormatter(info: any): SlackFormatterResponse {
  // Try and fetch injected web3 which we can use to customize the transaction receipt hyperlink:
  let networkId = 1;
  try {
    getWeb3()
      .eth.net.getId()
      .then((_netId) => {
        if (_netId) networkId = _netId;
      });
  } catch (err) {
    // Do nothing, use default "EtherscanLinkMarkdown"
  }

  try {
    if (!("level" in info) || !("at" in info) || !("message" in info))
      throw new Error("WINSTON MESSAGE INCORRECTLY CONFIGURED");

    // Each part of the slack response is a separate block with markdown text within it.
    // All slack responses start with the heading level and where the message came from.
    const formattedResponse: SlackFormatterResponse = {
      // If the bot contains an identifier flag it should be included in the heading.
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `[${info.level}] *${info["bot-identifier"]}* (${info.at})⭢${info.message}\n` },
        },
      ],
    };
    // All messages from winston come in as a Json object. The loop below expands this object and adds mrkdwn sections
    // for each key value pair with a bullet point. If the section is an object then it was passed containing multiple
    // sub points. This is also expanded as a sub indented section.
    for (const key in info) {
      // these keys have been printed in the previous block or should not be included in slack messages.
      if (key == "at" || key == "level" || key == "message" || key == "bot-identifier" || key == "notificationPath")
        continue;

      // If the key is `mrkdwn` then simply return only the markdown as the txt object. This assumes all formatting has
      // been applied in the bot itself. For example the monitor bots which conform to strict formatting rules.
      if (key == "mrkdwn") {
        formattedResponse.blocks.push({ type: "section", text: { type: "mrkdwn", text: ` ${info[key]}` } });
      }
      // If the value in the message is an object then spread each key value pair within the object.
      else if (typeof info[key] === "object" && info[key] !== null) {
        // Note: create local reference to this object, so we can modify it in the if statement.
        const newBlock: SectionBlock = { type: "section", text: { type: "mrkdwn", text: ` • _${key}_:\n` } };
        // Note: after pushing, we can still modify newBlock and it will affect the element in the array since what's
        // pushed into the array is a pointer.
        formattedResponse.blocks.push(newBlock);
        // For each key value pair within the object, spread the object out for formatting.
        for (const subKey in info[key]) {
          // If the length of the value is 66 then we know this is a transaction hash. Format accordingly.
          if (info[key][subKey]?.length == 66) {
            newBlock.text.text += `    - _tx_: ${createEtherscanLinkMarkdown(info[key][subKey], networkId)}\n`;
          }
          // If the length of the value is 42 then we know this is an address. Format accordingly.
          else if (info[key][subKey]?.length == 42) {
            newBlock.text.text += `    - _${subKey}_: ${createEtherscanLinkMarkdown(info[key][subKey], networkId)}\n`;
          }
          // If the value within the object itself is an object we dont want to spread it any further. Rather,
          // convert the object to a string and print it along side it's key value pair.
          else if (typeof info[key][subKey] === "object" && info[key][subKey] !== null) {
            formattedResponse.blocks.push({
              type: "section",
              text: { type: "mrkdwn", text: `    - _${subKey}_: ${JSON.stringify(info[key][subKey])}\n` },
            });
            // Else if not a address, transaction or object then print as ` - key: value`
          } else {
            formattedResponse.blocks.push({
              type: "section",
              text: { type: "mrkdwn", text: `    - _${subKey}_: ${info[key][subKey]}\n` },
            });
          }
        }
        // Else, if the input is not an object then print the values as key value pairs. First check for addresses or txs
      } else if (info[key]) {
        const lastBlock = formattedResponse.blocks[formattedResponse.blocks.length - 1] as SectionBlock;
        // like with the previous level, if there is a value that is a transaction or an address format accordingly
        if (info[key]?.length == 66) {
          lastBlock.text.text += ` • _tx_: ${createEtherscanLinkMarkdown(info[key], networkId)}\n`;
        }
        // If the length of the value is 42 then we know this is an address. Format accordingly.
        else if (info[key]?.length == 42) {
          lastBlock.text.text += ` • _${key}_: ${createEtherscanLinkMarkdown(info[key], networkId)}\n`;
        } else {
          formattedResponse.blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: ` • _${key}_: ${info[key]}\n` },
          });
        }
        // Else, if the value from the key value pair is null still show the key in the log. For example if a param is
        // logged but empty we still want to see the key.
      } else if (info[key] == null) {
        formattedResponse.blocks.push({ type: "section", text: { type: "mrkdwn", text: ` • _${key}_: null` } });
      }
    }
    // Add a divider to the end of the message to help distinguish messages in long lists.
    formattedResponse.blocks.push({ type: "divider" });
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

type TransportOptions = NonNullable<ConstructorParameters<typeof Transport>[0]>;
interface Options extends TransportOptions {
  name?: string;
  transportConfig: {
    escalationPathWebhookUrls?: { [key: string]: string };
    defaultWebHookUrl: string;
  };
  formatter: (info: any) => SlackFormatterResponse;
  mrkdwn?: boolean;
  proxy?: AxiosRequestConfig["proxy"];
}

class SlackHook extends Transport {
  private name: string;
  private readonly escalationPathWebhookUrls: { [key: string]: string };
  private readonly defaultWebHookUrl: string;
  private readonly formatter: (info: any) => SlackFormatterResponse;
  private readonly mrkdwn: boolean;
  private readonly axiosInstance: AxiosInstance;

  constructor(opts: Options) {
    super(opts);
    this.name = opts.name || "slackWebhook";
    this.level = opts.level || undefined;
    this.escalationPathWebhookUrls = opts.transportConfig.escalationPathWebhookUrls || {};
    this.defaultWebHookUrl = opts.transportConfig.defaultWebHookUrl;
    this.formatter = opts.formatter;
    this.mrkdwn = opts.mrkdwn || false;
    this.axiosInstance = axios.create({ proxy: opts.proxy });
  }

  async log(info: any, callback: () => void) {
    // If the log contains a notification path then use a custom slack webhook service. This lets the transport route to
    // diffrent slack channels depending on the context of the log.
    const webhookUrl = this.escalationPathWebhookUrls[info.notificationPath] ?? this.defaultWebHookUrl;

    const payload: { blocks?: Block[]; text?: string; mrkdwn?: boolean } = { mrkdwn: this.mrkdwn };
    const layout = this.formatter(info);
    payload.blocks = layout.blocks || undefined;
    let errorThrown = false;
    // If the overall payload is less than 3000 chars then we can send it all in one go to the slack API.
    if (JSON.stringify(payload).length < 3000) {
      const response = await this.axiosInstance.post(webhookUrl, payload);
      if (response.status != 200) errorThrown = true;
    } else {
      // If it's more than 3000 chars then we need to split the message sent to slack API into multiple calls.
      let messageIndex = 0;
      const processedBlocks: Block[][] = [[]];
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
        const response = await this.axiosInstance.post(webhookUrl, payload);
        if (response.status != 200) errorThrown = true;
      }
    }
    callback();
    if (errorThrown) console.error("slack transport error!");
  }
}

export function createSlackTransport(transportConfig: Options["transportConfig"]): SlackHook {
  return new SlackHook({
    level: "info",
    transportConfig,
    formatter: (info) => {
      return slackFormatter(info);
    },
  });
}
