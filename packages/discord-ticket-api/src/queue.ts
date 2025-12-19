import { Queue, Worker, QueueOptions, WorkerOptions, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import type { Redis as IORedisClient, RedisOptions } from "ioredis";
import type { FastifyBaseLogger } from "fastify";

const Redis = IORedis.default || IORedis;
import { AppEnv } from "./env.js";
import { TicketJobData } from "./services/TicketService.js";
import { TicketPoster } from "./discord/TicketPoster.js";

export function createRedisConnection(env: AppEnv): RedisOptions {
  const tls = env.REDIS_TLS ? { tls: {} as Record<string, unknown> } : undefined;
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
    // Helps avoid noisy periodic disconnects behind NAT / LBs by keeping the socket active.
    // Node default is 0 (disabled) in many environments.
    keepAlive: 30_000,
    connectTimeout: 10_000,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Back off reconnects a bit; ioredis will reconnect by default, but without this it can spam.
    retryStrategy: (times) => Math.min(times * 50, 2_000),
    ...tls,
  };
}

export type TicketQueue = {
  queue: Queue<TicketJobData, unknown, string>;
  events: QueueEvents;
  close: () => Promise<void>;
};

function attachRedisLogging(connection: IORedisClient, logger: FastifyBaseLogger, name: string, env: AppEnv) {
  connection.on("error", (err) => {
    logger.warn(
      { err, redis: { host: env.REDIS_HOST, port: env.REDIS_PORT }, connection: name },
      "Redis connection error"
    );
  });
  connection.on("close", () => {
    logger.warn({ redis: { host: env.REDIS_HOST, port: env.REDIS_PORT }, connection: name }, "Redis connection closed");
  });
  connection.on("reconnecting", () => {
    logger.info(
      { redis: { host: env.REDIS_HOST, port: env.REDIS_PORT }, connection: name },
      "Redis connection reconnecting"
    );
  });
  connection.on("end", () => {
    logger.warn({ redis: { host: env.REDIS_HOST, port: env.REDIS_PORT }, connection: name }, "Redis connection ended");
  });
}

export function createQueue(env: AppEnv, logger: FastifyBaseLogger): TicketQueue {
  const connectionOpts = createRedisConnection(env);
  const queueConnection = new Redis(connectionOpts);
  const eventsConnection = new Redis(connectionOpts);

  attachRedisLogging(queueConnection, logger, "queue", env);
  attachRedisLogging(eventsConnection, logger, "events", env);

  const opts: QueueOptions = { connection: queueConnection };
  const queue = new Queue<TicketJobData, unknown, string>(env.QUEUE_NAME, opts);

  // BullMQ recommends using a dedicated connection for QueueEvents.
  const events = new QueueEvents(env.QUEUE_NAME, { connection: eventsConnection });
  events.on("failed", ({ jobId, failedReason }) => {
    logger.error({ jobId, failedReason }, "Queue job failed");
  });
  events.on("completed", ({ jobId }) => {
    logger.info({ jobId }, "Queue job completed");
  });
  events.on("error", (err: unknown) => {
    logger.warn({ err, queue: env.QUEUE_NAME }, "QueueEvents error");
  });

  // Queue can also surface redis errors; log them to avoid uncaught/no-context stack traces.
  // (Some error conditions originate from underlying Redis sockets, e.g. ECONNRESET.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (queue as any).on?.("error", (err: unknown) => {
    logger.warn({ err, queue: env.QUEUE_NAME }, "Queue error");
  });

  const close = async () => {
    // Close BullMQ objects first, then underlying Redis connections.
    await Promise.allSettled([events.close(), queue.close()]);
    await Promise.allSettled([queueConnection.quit(), eventsConnection.quit()]);
  };

  return { queue, events, close };
}

export function createWorker(env: AppEnv, logger: FastifyBaseLogger): Worker<TicketJobData, void, string> {
  const connection = new Redis(createRedisConnection(env));
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
      logger.info({ jobId: job.id }, "Processing ticket job");
      await poster.postTicket({
        channelId: data.channelId,
        title: data.title,
        content: data.content,
      });
      logger.info({ jobId: job.id }, "Ticket posted");
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
