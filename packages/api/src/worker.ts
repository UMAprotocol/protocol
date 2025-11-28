import { Queue } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { AppEnv, loadEnv } from "./env.js";
import { createRedisConnection, createWorker } from "./queue.js";
import { TicketJobData } from "./services/TicketService.js";

const Redis = IORedis.default || IORedis;
type CleanupFn = () => Promise<void>;

async function setupJobMode(
  env: AppEnv,
  logger: pino.Logger,
  cleanupFns: CleanupFn[],
  shutdown: (reason: string) => Promise<void>
): Promise<void> {
  const monitorQueue = new Queue<TicketJobData, unknown, string>(env.QUEUE_NAME, {
    connection: new Redis(createRedisConnection(env)),
  });
  cleanupFns.push(async () => monitorQueue.close());

  const idleGraceMs = env.WORKER_JOB_IDLE_GRACE_SECONDS * 1000;
  const checkIntervalMs = env.WORKER_JOB_CHECK_INTERVAL_SECONDS * 1000;
  const maxRuntimeMs = env.WORKER_JOB_MAX_RUNTIME_SECONDS ? env.WORKER_JOB_MAX_RUNTIME_SECONDS * 1000 : undefined;

  let lastObservedWorkAt = Date.now();

  const stopTimers = () => {
    if (interval) clearInterval(interval);
    if (maxRuntimeTimer) clearTimeout(maxRuntimeTimer);
  };

  const checkQueueIdle = async () => {
    try {
      const [waiting, delayed, active] = await Promise.all([
        monitorQueue.getWaitingCount(),
        monitorQueue.getDelayedCount(),
        monitorQueue.getActiveCount(),
      ]);
      const total = waiting + delayed + active;
      if (total > 0) {
        lastObservedWorkAt = Date.now();
        logger.debug({ waiting, delayed, active }, "Job mode queue check: work pending");
        return;
      }

      const idleForMs = Date.now() - lastObservedWorkAt;
      if (idleForMs >= idleGraceMs) {
        logger.info({ idleSeconds: Math.floor(idleForMs / 1000) }, "Queue idle beyond grace period; stopping worker");
        stopTimers();
        await shutdown("queue idle");
      }
    } catch (err) {
      logger.error({ err }, "Job-mode queue check failed");
    }
  };

  const interval = setInterval(() => {
    void checkQueueIdle();
  }, checkIntervalMs);

  const maxRuntimeTimer =
    maxRuntimeMs !== undefined
      ? setTimeout(() => {
          logger.info(
            { maxRuntimeSeconds: env.WORKER_JOB_MAX_RUNTIME_SECONDS },
            "Max runtime reached; stopping worker"
          );
          stopTimers();
          void shutdown("max runtime reached");
        }, maxRuntimeMs)
      : undefined;

  logger.info(
    {
      mode: env.WORKER_MODE,
      idleGraceSeconds: env.WORKER_JOB_IDLE_GRACE_SECONDS,
      idleCheckSeconds: env.WORKER_JOB_CHECK_INTERVAL_SECONDS,
      maxRuntimeSeconds: env.WORKER_JOB_MAX_RUNTIME_SECONDS ?? null,
    },
    "Job mode enabled; worker will exit when queue is idle"
  );

  await checkQueueIdle();
}

async function main() {
  const env = loadEnv();
  const logger = pino({ level: process.env.LOG_LEVEL || "info", name: "ticketing-worker" });
  const worker = createWorker(env, logger);
  const cleanupFns: CleanupFn[] = [() => worker.close()];
  let shuttingDown = false;

  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, "Shutting down worker...");

    for (const close of cleanupFns) {
      try {
        await close();
      } catch (err) {
        logger.error({ err }, "Error during shutdown");
      }
    }

    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  if (env.WORKER_MODE === "job") {
    await setupJobMode(env, logger, cleanupFns, shutdown);
  }

  logger.info(
    { queue: env.QUEUE_NAME, rateLimitSeconds: env.RATE_LIMIT_SECONDS, mode: env.WORKER_MODE },
    "Worker started"
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
