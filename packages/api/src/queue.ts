import { Queue, Worker, QueueOptions, WorkerOptions, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { AppEnv } from "./env.js";
import { TicketJobData } from "./services/TicketService.js";
import { TicketPoster } from "./discord/TicketPoster.js";

export function createRedisConnection(env: AppEnv): IORedis.RedisOptions {
  const tls = env.REDIS_TLS ? { tls: {} as Record<string, unknown> } : undefined;
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...tls,
  };
}

export function createQueue(env: AppEnv, logger: pino.Logger): Queue<TicketJobData, unknown, string> {
  const connection = new IORedis(createRedisConnection(env));
  const opts: QueueOptions = {
    connection,
  };
  const queue = new Queue<TicketJobData, unknown, string>(env.QUEUE_NAME, opts);
  const events = new QueueEvents(env.QUEUE_NAME, { connection });
  events.on("failed", ({ jobId, failedReason }) => {
    logger.error({ jobId, failedReason }, "Queue job failed");
  });
  events.on("completed", ({ jobId }) => {
    logger.info({ jobId }, "Queue job completed");
  });
  return queue;
}

export function createWorker(env: AppEnv, logger: pino.Logger): Worker<TicketJobData, void, string> {
  const connection = new IORedis(createRedisConnection(env));
  const workerOpts: WorkerOptions = {
    connection,
    concurrency: 1,
    // Rate limit to respect Ticket Tool constraints: 1 job per RATE_LIMIT_SECONDS
    limiter: {
      max: 1,
      duration: env.RATE_LIMIT_SECONDS * 1000,
    },
  };

  const poster = new TicketPoster(env.DISCORD_BOT_TOKEN);
  const worker = new Worker<TicketJobData, void, string>(
    env.QUEUE_NAME,
    async (job) => {
      const data = job.data;
      logger.info({ jobId: job.id, correlationId: data.correlationId }, "Processing ticket job");
      await poster.postTicket({
        channelId: data.channelId,
        title: data.title,
        content: data.content,
      });
      logger.info({ jobId: job.id, correlationId: data.correlationId }, "Ticket posted");
    },
    workerOpts
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Worker job failed");
  });
  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Worker job completed");
  });
  worker.on("error", (err) => {
    logger.error({ err }, "Worker error");
  });

  return worker;
}
