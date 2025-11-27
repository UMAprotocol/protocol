import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import pino from "pino";
import { loadEnv } from "./env.js";
import { createQueue } from "./queue.js";
import { TicketQueueService } from "./services/TicketService.js";
import { ticketsRoutes } from "./routes/tickets.js";

export async function buildServer() {
  const env = loadEnv();
  const logger = pino({ level: process.env.LOG_LEVEL || "info", name: "ticketing-api" });
  const app = Fastify({ logger });

  await app.register(helmet);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  const queue = createQueue(env, logger);
  const ticketService = new TicketQueueService(queue, env);
  await ticketsRoutes(app, ticketService);

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


