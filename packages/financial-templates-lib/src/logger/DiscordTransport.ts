import { delay } from "../helpers/delay";

import Transport from "winston-transport";

import axios from "axios";

type TransportOptions = ConstructorParameters<typeof Transport>[0];

interface Body {
  username: string;
  avatar_url: string;
  embeds: { title: string; description: string; color: number }[];
}
interface QueueElement {
  body: Body;
  webHook: string;
}

export class DiscordTransport extends Transport {
  private readonly defaultWebHookUrl: string | string[];
  private readonly escalationPathWebhookUrls: { [key: string]: string | string[] };
  private readonly postOnNonEscalationPaths: boolean;

  private logQueue: QueueElement[];
  private isQueueBeingExecuted = false;

  constructor(
    winstonOpts: TransportOptions,
    ops: {
      defaultWebHookUrl: string;
      escalationPathWebhookUrls: { [key: string]: string };
      postOnNonEscalationPaths: boolean;
    }
  ) {
    super(winstonOpts);
    this.defaultWebHookUrl = ops.defaultWebHookUrl;
    this.escalationPathWebhookUrls = ops.escalationPathWebhookUrls ?? {};
    this.postOnNonEscalationPaths = ops.postOnNonEscalationPaths ?? true;

    this.logQueue = [];
  }

  // Note: info must be any because that's what the base class uses.
  async log(info: any, callback: () => void): Promise<void> {
    try {
      if (!info.mrkdwn) return; // We only ever want to send messages to Discord that have Markdown in them.
      const body = {
        username: "UMA Infrastructure",
        avatar_url: "https://i.imgur.com/RCcxxEZ.png",
        embeds: [{ title: `${info.message}`, description: this.formatLinks(info.mrkdwn), color: 9696729 }],
      };

      // A log message can conditionally contain additional Discord specific paths. Validate these first.
      let webHooks: string[] = [];
      if (info.discordPaths) {
        // If it is null then this is a noop message for Discord and the log should be skipped.
        if (info.discordPaths === null) return;

        // Else, Assign a webhook for each escalationPathWebHook defined for the provided discordPaths. This lets
        // the logger define exactly which logs should go to which discord channel.
        webHooks = info.discordPaths.map((discordPath: string) => this.escalationPathWebhookUrls[discordPath]);
      }

      // Else, There are no discord specific settings. In this case, we treat this like a normal log. Either the
      // transport is configured to send on undefined escalation paths (will use default path if path does
      // not exist) or the transport has a defined escalation path for the given message's notification path.
      else if (this.postOnNonEscalationPaths || this.escalationPathWebhookUrls[info.notificationPath]) {
        // The webhook is preferentially set to the defined escalation path, or the default webhook.
        const webHook = this.escalationPathWebhookUrls[info.notificationPath] ?? this.defaultWebHookUrl;

        // If the webHook is an object it can contain multiple hooks within it. Else, it must be a single hook.
        if (Array.isArray(webHook)) webHooks = webHook;
        else webHooks = [webHook];
      }

      // Send webhook request to each of the configured webhooks upstream. This posts the messages on Discord. Execute
      // these sequentially with a soft delay of 2 seconds between calls to avoid hitting the discord rate limit.
      if (webHooks.length) for (const webHook of webHooks) this.logQueue.push({ webHook, body });

      await this.executeLogQueue(); // Start processing the log que.
    } catch (error) {
      console.error("Discord error", error);
    }

    callback();
  }

  // Processes a queue of logs produced by the transport. Executes sequentially and listens to the response from the
  // Discord API to back off and sleep if we are exceeding their rate limiting. Sets the parent transports isFlushed
  // variable to block the bot from closing until the whole queue has been flushed.
  async executeLogQueue(backOffDuration = 0): Promise<void> {
    if (this.isQueueBeingExecuted) return; // If the queue is currently being executed, return.
    this.isQueueBeingExecuted = true; // Set the queue to being executed.
    // Set the parent isFlushed to false to prevent the logger from closing while the queue is being executed. Note this
    // is separate variable from the isQueueBeingExecuted flag as this isFlushed is global for the logger instance.
    (this as any).parent.isFlushed = false;

    // If the previous iteration set a backOffDuration then wait for this duration.
    if (backOffDuration != 0) await delay(backOffDuration);

    while (this.logQueue.length) {
      try {
        // Pop off the first element (oldest) and try send it to discord. If this errors then we are being rate limited.
        await axios.post(this.logQueue[0].webHook, this.logQueue[0].body);
        this.logQueue.shift(); // If the request does not fail remove it from the log queue as having been executed.
      } catch (error: any) {
        // Extract the retry_after from the response. This is the Discord API telling us how long to back off for.
        let _backOffDuration = error?.response?.data.retry_after;
        // If they tell us to back off for more than a minute then ignore it and cap at 1 min. This is enough time in
        // practice to recover from a rate limit while not making the bot hang indefinitely.
        if (_backOffDuration > 60) _backOffDuration = 60;
        // We removed the element in the shift above, push it back on to the start of the queue to not drop any message.
        // As we have errored we now need to re-enter the executeLogQuery method. Set isQueueBeingExecuted to false and
        // re-call the executeLogQuery. This will initiate the backoff delay and then continue to process the queue.
        this.isQueueBeingExecuted = false;
        await this.executeLogQueue(_backOffDuration);
      }
    }

    // Only if we get to the end of the function (no errors) then we can set isQueueBeingExecuted to false and can
    // set the parent isFlushed to true, enabling the bot to close out.
    this.isQueueBeingExecuted = false;
    (this as any).parent.isFlushed = true;
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
      const startIndex = msg.indexOf("<", i);
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
