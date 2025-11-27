import pino from "pino";
import { loadEnv } from "./env.js";
import { createWorker } from "./queue.js";

async function main() {
  const env = loadEnv();
  const logger = pino({ level: process.env.LOG_LEVEL || "info", name: "ticketing-worker" });
  const worker = createWorker(env, logger);
  logger.info({ queue: env.QUEUE_NAME, rateLimitSeconds: env.RATE_LIMIT_SECONDS }, "Worker started");

  const shutdown = async () => {
    logger.info("Shutting down worker...");
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


