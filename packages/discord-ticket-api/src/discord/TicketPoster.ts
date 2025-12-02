import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";

const DISCORD_MAX_CHAR_LIMIT = 2000;
const TRUNCATED = " [TRUNCATED] ";

export type TicketPostParams = {
  botToken: string;
  channelId: string;
  title: string;
  content: string;
};

export class TicketPoster {
  private rest: REST;

  constructor(botToken: string) {
    this.rest = new REST({ version: "10" }).setToken(botToken);
  }

  async postTicket({ channelId, title, content }: Omit<TicketPostParams, "botToken">): Promise<void> {
    const header = `$ticket ${title}\n`;
    const truncated = this.truncateMessage(
      this.removeAnchorTextFromLinks(content),
      DISCORD_MAX_CHAR_LIMIT - header.length
    );
    const message = header + truncated;

    await this.rest.post(Routes.channelMessages(channelId), {
      body: {
        content: message,
        allowed_mentions: { parse: [] },
      },
    });
  }

  // Some transports do not support markdown formatted links (e.g. <https://google.com|google.com>). This method removes
  // the text anchor and leave plain URLs in the message.
  private removeAnchorTextFromLinks(msg: string): string {
    const anchorTextRegex = /<([^|]+)\|[^>]+>/g;
    // $1 is a backreference to the first capture group containing plain URL.
    return msg.replace(anchorTextRegex, "$1");
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
