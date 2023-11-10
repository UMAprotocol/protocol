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

import { TransportError } from "./TransportError";

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

export const SLACK_MAX_CHAR_LIMIT = 3000;

// Note: info is any because it comes directly from winston.
function slackFormatter(info: any): SlackFormatterResponse {
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
      if (
        key == "at" ||
        key == "level" ||
        key == "message" ||
        key == "bot-identifier" ||
        key == "notificationPath" ||
        key == "discordPaths"
      )
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
          // If the value within the object itself is an object we dont want to spread it any further. Rather,
          // convert the object to a string and print it along side it's key value pair.
          if (typeof info[key][subKey] === "object" && info[key][subKey] !== null) {
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
        formattedResponse.blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: ` • _${key}_: ${info[key]}\n` },
        });

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
    this.axiosInstance = axios.create({
      proxy: opts.proxy,
      validateStatus: (status) => {
        return status == 200;
      },
    });
  }

  async log(info: any, callback: (error?: unknown) => void): Promise<void> {
    try {
      // If the log contains a notification path then use a custom slack webhook service. This lets the transport route to
      // different slack channels depending on the context of the log.
      const webhookUrl = this.escalationPathWebhookUrls[info.notificationPath] ?? this.defaultWebHookUrl;

      const payload: { blocks?: Block[]; text?: string; mrkdwn?: boolean } = { mrkdwn: this.mrkdwn };
      const layout = this.formatter(info);
      payload.blocks = layout.blocks || undefined;
      // If the overall payload is less than 3000 chars then we can send it all in one go to the slack API.
      if (JSON.stringify(payload).length < SLACK_MAX_CHAR_LIMIT) {
        await this.axiosInstance.post(webhookUrl, payload);
      } else {
        // Iterate over each message to send and generate a axios call for each message.
        for (const processedBlock of processMessageBlocks(payload.blocks)) {
          payload.blocks = processedBlock;
          await this.axiosInstance.post(webhookUrl, payload);
        }
      }
    } catch (error) {
      return callback(new TransportError("Slack", error, info));
    }
    callback();
  }
}

function processMessageBlocks(blocks: Block[]): Block[][] {
  // If it's more than 3000 chars then we need to split the message sent to slack API into multiple calls.
  let messageIndex = 0;

  // Split any block that's longer than 3000 chars by new line (\n) if possible.
  const splitBlocks = [];
  for (const block of blocks) {
    // If any of the smaller blocks is still larger than 3000 chars then we must redact part of the message.
    for (let smallerBlock of splitByNewLine(block)) {
      if (JSON.stringify(smallerBlock).length > SLACK_MAX_CHAR_LIMIT) {
        const stringifiedBlock = JSON.stringify(smallerBlock);
        const redactedBlock =
          stringifiedBlock.substr(0, 1400) +
          "-MESSAGE REDACTED DUE TO LENGTH-" +
          stringifiedBlock.substr(stringifiedBlock.length - 1400, stringifiedBlock.length);
        smallerBlock = JSON.parse(redactedBlock);
      }
      splitBlocks.push(smallerBlock);
    }
  }

  const processedBlocks: Block[][] = [[]];
  for (const block of splitBlocks) {
    if (JSON.stringify([...processedBlocks[messageIndex], block]).length > SLACK_MAX_CHAR_LIMIT) {
      // If the set blocks is larger than 3000 then we must increment the message index, to enable sending the set
      // of messages over multiple calls to the slack API. The amounts to splitting up one Winston log into multiple
      // slack messages with no single slack message exceeding the 3000 char limit.
      messageIndex += 1;
    }
    if (!processedBlocks[messageIndex]) processedBlocks[messageIndex] = [];
    processedBlocks[messageIndex].push(block);
  }

  return processedBlocks;
}

export function splitByNewLine(block: Block): Block[] {
  // No need to split if the block is already under limit.
  if (block.type === "divider" || JSON.stringify(block).length <= SLACK_MAX_CHAR_LIMIT) {
    return [block];
  }

  const lines = block.text.text.split("\n");
  const smallerBlocks: SectionBlock[] = [];
  for (let line of lines) {
    // Skip empty lines.
    if (line.length == 0) continue;

    // Add a new block if the previous block's content + current line exceed the char limit.
    line += "\n";
    const newBlock =
      smallerBlocks.length === 0
        ? createSectionBlock(line)
        : createSectionBlock(smallerBlocks[smallerBlocks.length - 1].text.text + line);
    if (JSON.stringify(newBlock).length + line.length > SLACK_MAX_CHAR_LIMIT) {
      smallerBlocks.push(createSectionBlock(line));
    } else {
      if (smallerBlocks.length === 0) smallerBlocks.push(createSectionBlock(""));
      smallerBlocks[smallerBlocks.length - 1].text.text += line;
    }
  }
  return smallerBlocks;
}

function createSectionBlock(text: string): SectionBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
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
