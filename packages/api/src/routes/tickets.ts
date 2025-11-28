import { FastifyInstance } from "fastify";
import { z } from "zod";
import { TicketService } from "../services/TicketService.js";

const BodySchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  correlationId: z.string().optional(),
});

export async function ticketsRoutes(app: FastifyInstance, ticketService: TicketService): Promise<void> {
  app.post("/tickets", async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const { title, content, correlationId } = parsed.data;
    const { jobId } = await ticketService.enqueue({ title, content, correlationId });
    return reply.status(202).send({ jobId });
  });
}
