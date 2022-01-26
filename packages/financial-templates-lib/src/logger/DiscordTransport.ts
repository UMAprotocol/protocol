import Transport from "winston-transport";

import axios from "axios";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

export class DiscordTransport extends Transport {
  private readonly defaultWebHookUrl: string;
  private readonly escalationPathWebhookUrls: { [key: string]: string };
  constructor(
    winstonOpts: TransportOptions,
    ops: { defaultWebHookUrl: string; escalationPathWebhookUrls: { [key: string]: string } }
  ) {
    super(winstonOpts);
    this.defaultWebHookUrl = ops.defaultWebHookUrl;
    this.escalationPathWebhookUrls = ops.escalationPathWebhookUrls || {};
  }

  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: () => void): Promise<void> {
    try {
      const body = {
        username: "UMA Infrastructure",
        avatar_url: "https://i.imgur.com/RCcxxEZ.png",
        embeds: [{ title: `${info.at}: ${info.message}`, description: this.formatLinks(info.mrkdwn), color: 9696729 }],
      };

      // Select webhook url based on escalation path. if escalation path is not found, use default webhook url.
      const webHook = this.escalationPathWebhookUrls[info.notificationPath] ?? this.defaultWebHookUrl;

      // Send webhook request. This posts the message on discord.
      await axios.post(webHook, body);
    } catch (error) {
      console.error("Discord error", error);
    }

    callback();
  }

  // Discord URLS are formatted differently to markdown links produced upstream in the bots. For example, slack links
  // will look like this <https://google.com|google.com> but links for discord should look like this
  // [google.com](https://google.com).This function takes in the one format and converts it to the other such that
  // links sent to discord are nicely formatted and clickable.
  formatLinks(msg: any): any {
    // Find the start and end indexes of all the markdown links.
    const startIndexes: any = [];
    const endIndexes: any = [];
    for (let i = 0; i < msg.length; i++) {
      const startIndex = msg.indexOf("<http", i);
      if (!startIndexes.includes(startIndex) && startIndex != -1) startIndexes.push(startIndex);

      const endIndex = msg.indexOf(">", i);
      if (!endIndexes.includes(endIndex) && endIndex != -1) endIndexes.push(endIndex);
    }

    // For each markdown link, build the new link with the discord format. Replace the original link with the new one.
    let modifiedMessage = msg;
    for (let i = 0; i < startIndexes.length; i++) {
      const originalUrl = msg.substring(startIndexes[i], endIndexes[i] + 1);
      const pipeIndex = originalUrl.indexOf("|");
      const markdownUrl =
        `[${originalUrl.substring(pipeIndex + 1, originalUrl.length - 1)}]` + // hyperlink
        `(${originalUrl.substring(1, pipeIndex)})`; // url
      modifiedMessage = modifiedMessage.replace(originalUrl, markdownUrl);
    }
    return modifiedMessage;
  }
}
