import { Queue } from "bullmq";
import { AppEnv } from "../env.js";

export type OpenTicketRequest = {
  title: string;
  content: string;
};

export interface TicketService {
  enqueue(request: OpenTicketRequest): Promise<{ jobId: string }>;
}

export type TicketJobData = {
  channelId: string;
  title: string;
  content: string;
};

export class TicketQueueService implements TicketService {
  private queue: Queue<TicketJobData, unknown, string>;
  private env: AppEnv;

  constructor(queue: Queue<TicketJobData, unknown, string>, env: AppEnv) {
    this.queue = queue;
    this.env = env;
  }

  async enqueue(request: OpenTicketRequest): Promise<{ jobId: string }> {
    const job = await this.queue.add(
      "open-ticket",
      {
        channelId: this.env.DISCORD_CHANNEL_ID,
        title: request.title,
        content: request.content,
      },
      {
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600, count: 1000 },
      }
    );
    return { jobId: job.id as string };
  }
}
