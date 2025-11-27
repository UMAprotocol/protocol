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
        const truncated = this.truncateMessage(this.removeAnchorTextFromLinks(content), DISCORD_MAX_CHAR_LIMIT - header.length);
        const message = header + truncated;

        await this.rest.post(Routes.channelMessages(channelId), {
            body: {
                content: message,
                allowed_mentions: { parse: [] },
            },
        });
    }

    private removeAnchorTextFromLinks(text: string): string {
        // Replace [text](url) with url
        return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$2");
    }

    private truncateMessage(message: string, limit: number): string {
        if (limit < TRUNCATED.length) throw new Error("Invalid truncated message limit!");
        if (message.length <= limit) return message;

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = message.match(urlRegex);
        if (urls === null) return message.slice(0, limit - TRUNCATED.length) + TRUNCATED;

        const chunks = message.split(urlRegex);
        let truncatedLength = message.length;
        let isUrlRound = false;

        for (let i = chunks.length - 1; i >= 0; i--) {
            if (truncatedLength <= limit) break;
            if (urls.includes(chunks[i]) && !isUrlRound) continue;

            if (chunks[i].length > TRUNCATED.length) {
                const retained = Math.max(0, isUrlRound ? 0 : chunks[i].length - TRUNCATED.length - (truncatedLength - limit));
                truncatedLength -= chunks[i].length - retained - TRUNCATED.length;
                chunks[i] = chunks[i].slice(0, retained) + TRUNCATED;
            }

            if (!isUrlRound && i === 0) {
                isUrlRound = true;
                i = chunks.length;
            }
        }

        const joined = chunks.join("");
        if (joined.length <= limit) return joined;
        return message.slice(0, limit - TRUNCATED.length) + TRUNCATED;
    }
}


