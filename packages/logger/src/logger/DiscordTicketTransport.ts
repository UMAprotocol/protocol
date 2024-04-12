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

import { isDictionary } from "../helpers/typeGuards";
import { PersistentTransport } from "./PersistentTransport";
import { removeAnchorTextFromLinks } from "./Formatters";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

const Config = ss.object({
  botToken: ss.string(),
  channelIds: ss.optional(ss.record(ss.string(), ss.string())),
  rateLimit: ss.optional(ss.number()),
});
// Config object becomes a type
// {
//   botToken: string;
//   channelIds?: Record<string,string>;
//   rateLimit?: number;
// }
export type Config = ss.Infer<typeof Config>;

// this turns an unknown ( like json parsed data) into a config, or throws an error
export function createConfig(config: unknown): Config {
  return ss.create(config, Config);
}

const DISCORD_MAX_CHAR_LIMIT = 2000;
const TRUNCATED = " [TRUNCATED] ";

// Interface for log info object.
interface DiscordTicketInfo {
  message: string;
  mrkdwn: string;
  discordTicketChannel: string;
}

// Type guard for log info object.
export const isDiscordTicketInfo = (info: unknown): info is DiscordTicketInfo => {
  if (!isDictionary(info)) return false;
  return (
    typeof info.message === "string" && typeof info.mrkdwn === "string" && typeof info.discordTicketChannel === "string"
  );
};

export class DiscordTicketTransport extends PersistentTransport {
  private readonly botToken: string;
  private readonly channelIds: { [key: string]: string };

  private client: Client = new Client({ intents: [GatewayIntentBits.Guilds] });
  private channels: Map<string, TextBasedChannel> = new Map();

  protected readonly rateLimit: number;

  // Ticket tool does not allow more than 1 ticket to be opened per 10 seconds. By default we conservatively use
  // rateLimit of 15 seconds.
  constructor(winstonOpts: TransportOptions, { botToken, channelIds = {}, rateLimit = 15 }: Config) {
    super(winstonOpts, "Discord Ticket");

    this.botToken = botToken;
    this.channelIds = channelIds;

    this.rateLimit = rateLimit;
  }

  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: (error?: unknown) => void): Promise<void> {
    // We only try sending if the logging application has passed required parameters.
    if (isDiscordTicketInfo(info)) {
      // Callback and errors are handled within base class.
      await super.log(info, callback);
    } else {
      // Signal we're done here.
      callback();
    }
  }

  // Get Discord channel by its id and cache fetched ids.
  private async getChannel(channelId: string): Promise<TextBasedChannel> {
    const cachedChannel = this.channels.get(channelId);
    if (cachedChannel !== undefined) return cachedChannel;

    const channel = await this.client.channels.fetch(channelId);
    if (channel === null) throw new Error(`Discord channel ${channelId} not available!`);
    if (!channel.isTextBased()) throw new Error(`Invalid type for Discord channel ${channelId}!`);

    this.channels.set(channelId, channel);
    return channel;
  }

  // Logs queue element when processing persistent storage.
  async logQueueElement(info: Record<string, unknown>): Promise<void> {
    if (!isDiscordTicketInfo(info)) throw new Error(`Invalid info`);

    // Check if the channel ID is configured.
    if (!(info.discordTicketChannel in this.channelIds))
      throw new Error(`Missing channel ID for ${info.discordTicketChannel}!`);

    if (!this.client.isReady()) await this.login(); // Log in if not yet established the connection.

    // Get and verify requested Discord channel to post.
    const channelId = this.channelIds[info.discordTicketChannel];
    const channel = await this.getChannel(channelId);

    // Prepend the $ticket command and concatenate message title and content separated by newline.
    // Also remove anchor text from links and truncate the message to Discord's max character limit.
    const header = `$ticket ${info.message}\n`;
    const content = this.truncateMessage(
      removeAnchorTextFromLinks(info.mrkdwn),
      DISCORD_MAX_CHAR_LIMIT - header.length
    );
    const message = header + content;

    // Send out the message.
    await channel.send(message);
  }

  // Use bot token for establishing a connection to Discord API.
  private async login(): Promise<void> {
    await this.client.login(this.botToken);
  }

  // Truncate the message if it exceeds the provided character limit. Try to preserve URLs.
  truncateMessage(message: string, limit: number): string {
    if (limit < TRUNCATED.length) throw new Error("Invalid truncated message limit!");

    // If the message is short enough, return it as is.
    if (message.length <= limit) return message;

    // Regular expression to match URLs.
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.match(urlRegex);

    // If there are no URLs, just truncate the end of the message.
    if (urls === null) return message.slice(0, limit - TRUNCATED.length) + TRUNCATED;

    // Split the message into chunks around URLs for further processing.
    const messageChunks = message.split(urlRegex);

    // Truncate chunks until the message is short enough to fit the character limit. Cycle through the chunks backwards
    // in one or two rounds. The first round truncates the chunks that are not URLs. The second round also truncates the
    // URL chunks if the first round did not shorten the message enough. This is done to preserve URLs as much as possible.
    let truncatedMessageLength = message.length;
    let isUrlRound = false;
    for (let i = messageChunks.length - 1; i >= 0; i--) {
      if (truncatedMessageLength <= limit) break; // Stop if the message is short enough.

      if (urls.includes(messageChunks[i]) && !isUrlRound) continue; // Keep URLs from being truncated in the first round.

      // Truncate the chunk and update the truncated message length if it shortens the message. In the second round
      // truncate the whole URL chunk as there is no point in keeping a part of it.
      if (messageChunks[i].length > TRUNCATED.length) {
        const retainedChunkLength = Math.max(
          0,
          isUrlRound ? 0 : messageChunks[i].length - TRUNCATED.length - (truncatedMessageLength - limit)
        );
        truncatedMessageLength -= messageChunks[i].length - retainedChunkLength - TRUNCATED.length;
        messageChunks[i] = messageChunks[i].slice(0, retainedChunkLength) + TRUNCATED;
      }

      // If the first round is done, reset the counter for the second round truncating URLs.
      if (!isUrlRound && i === 0) {
        isUrlRound = true;
        i = messageChunks.length;
      }
    }

    // Concatenate the chunks back together.
    const truncatedMessage = messageChunks.join("");

    // In case there are too many chunks to even fit the TRUNCATED values we have to truncate the whole message without
    // giving any priority to URLs.
    if (truncatedMessage.length <= limit) return truncatedMessage;
    return message.slice(0, limit - TRUNCATED.length) + TRUNCATED;
  }
}
