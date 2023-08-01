// This transport enables winston logging to trigger opening of tickets through Discord bot. The transport configuration
// requires bot authentication token and a dictionary of channel IDs. In order to send the ticket command this bot also
// requires that the passed log object contains both message and mrkdwn strings, as well as discordTicketChannel
// resolving to any of configured channel ID mapping.
// This transport should be used with Ticket Tool (https://tickettool.xyz/) configured to trigger ticket commands on
// the resolved channel ID and whitelisting of bot ID. Also the Discord server should be configured to allow the bot
// to post messages on the ticket opening channel.
import { Client, GatewayIntentBits, TextBasedChannel } from "discord.js";
import * as ss from "superstruct";
import Transport from "winston-transport";

import { delay } from "../helpers/delay";
import { removeAnchorTextFromLinks } from "./Formatters";
import { isDictionary } from "./Logger";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

const Config = ss.object({
  botToken: ss.string(),
  channelIds: ss.optional(ss.record(ss.string(), ss.string())),
});
// Config object becomes a type
// {
//   botToken: string;
//   channelIds?: Record<string,string>;
// }
export type Config = ss.Infer<typeof Config>;

// this turns an unknown ( like json parsed data) into a config, or throws an error
export function createConfig(config: unknown): Config {
  return ss.create(config, Config);
}

// Interface for log info object.
interface DiscordTicketInfo {
  message: string;
  mrkdwn: string;
  discordTicketChannel: string;
}

// Interface for log que element.
interface QueueElement {
  channel: TextBasedChannel;
  message: string;
}

// Type guard for log info object.
export const isDiscordTicketInfo = (info: unknown): info is DiscordTicketInfo => {
  if (!isDictionary(info)) return false;
  return (
    typeof info.message === "string" && typeof info.mrkdwn === "string" && typeof info.discordTicketChannel === "string"
  );
};

export class DiscordTicketTransport extends Transport {
  private readonly botToken: string;
  private readonly channelIds: { [key: string]: string };

  private client: Client;

  private logQueue: QueueElement[];
  private isQueueBeingExecuted: boolean;

  public isFlushed: boolean;

  constructor(winstonOpts: TransportOptions, { botToken, channelIds = {} }: Config) {
    super(winstonOpts);
    this.botToken = botToken;
    this.channelIds = channelIds;

    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });

    this.logQueue = [];
    this.isQueueBeingExecuted = false;
    this.isFlushed = true;
  }

  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: () => void): Promise<void> {
    // We only try sending if we have all expected parameters and a matching channel ID.
    const canSend = isDiscordTicketInfo(info) && info.discordTicketChannel in this.channelIds;

    if (canSend) {
      try {
        if (!this.client.isReady()) await this.login(); // Log in if not yet established the connection.

        // Get and verify requested Discord channel to post.
        const channelId = this.channelIds[info.discordTicketChannel];
        const channel = await this.client.channels.fetch(channelId);
        if (channel === null) throw new Error(`Discord channel ${channelId} not available!`);
        if (!channel.isTextBased()) throw new Error(`Invalid type for Discord channel ${channelId}!`);

        // Prepend the $ticket command and concatenate message title and content separated by newline.
        const message = `$ticket ${info.message}\n${removeAnchorTextFromLinks(info.mrkdwn)}`;

        // Add the message to the queue and process it.
        this.logQueue.push({ channel, message });
        await this.executeLogQueue();
      } catch (error) {
        console.error("Discord Ticket error", error);
      }
    }

    callback();
  }

  // Use bot token for establishing a connection to Discord API.
  async login(): Promise<void> {
    this.isFlushed = false; // Set the isFlushed to false to prevent the logger from closing while logging in.
    await this.client.login(this.botToken);
    this.isFlushed = true;
  }

  private async executeLogQueue(): Promise<void> {
    if (this.isQueueBeingExecuted) return; // If the queue is currently being executed, return.
    this.isQueueBeingExecuted = true; // Lock the queue to being executed.
    // Set the isFlushed to false to prevent the logger from closing while the queue is being executed. Note this
    // is separate variable from the isQueueBeingExecuted flag as the isFlushed would not be released during any
    // retries.
    this.isFlushed = false;

    while (this.logQueue.length > 0) {
      try {
        // Try sending the oldest message from the queue.
        await this.logQueue[0].channel.send(this.logQueue[0].message);
        this.logQueue.shift(); // If the sending does not fail, remove it from the log queue as having been executed.

        // Ticket tool does not allow more than 1 ticket to be opened per 10 seconds. We are conservative and wait 15
        // seconds before opening the next ticket.
        await delay(15);
      } catch (error) {
        // If the sending fails, unlock the queue execution and throw the error so that the caller can handle it.
        // TODO: Add retry logic and flush the transport if all retries fail.
        this.isQueueBeingExecuted = false;
        this.isFlushed = true;
        throw error;
      }
    }

    // Unlock the queue execution enabling the bot to close out (if all other flushable transports are flushed).
    this.isQueueBeingExecuted = false;
    this.isFlushed = true;
  }
}
