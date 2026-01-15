import Fastify, { FastifyBaseLogger } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { createPinoLogger } from "@uma/logger";
import { loadEnv } from "./env.js";
import { createQueue } from "./queue.js";
import { TicketQueueService } from "./services/TicketService.js";
import { ticketsRoutes } from "./routes/tickets.js";

export async function buildServer(): Promise<{ app: ReturnType<typeof Fastify>; start: () => Promise<void> }> {
  const env = loadEnv();
  const logger = createPinoLogger({
    level: process.env.LOG_LEVEL || "info",
    botIdentifier: process.env.BOT_IDENTIFIER || "ticketing-api",
  }) as FastifyBaseLogger;
  const app = Fastify({ loggerInstance: logger });

  await app.register(helmet);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  const ticketQueue = createQueue(env, app.log);
  const ticketService = new TicketQueueService(ticketQueue.queue, env);
  await ticketsRoutes(app, ticketService);

  app.addHook("onClose", async () => {
    await ticketQueue.close();
  });

  app.get("/health", async (_, reply) => {
    return reply.status(200).send({ ok: true });
  });

  const start = async () => {
    const port = Number(env.PORT);
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info({ port }, "API listening");
  };

  return { app, start };
}
