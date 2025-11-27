import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ChannelIdsSchema = z
  .string()
  .transform((s) => {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
      throw new Error("DISCORD_CHANNEL_IDS must be a JSON object");
    } catch (err) {
      throw new Error("DISCORD_CHANNEL_IDS must be valid JSON object string");
    }
  });

const EnvSchema = z.object({
  PORT: z.string().default("8080"),
  NODE_ENV: z.string().default("development"),

  // Discord bot auth
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_CHANNEL_IDS: ChannelIdsSchema, // JSON string mapping channel keys to channel IDs

  // Queue
  QUEUE_NAME: z.string().default("discord-ticket-queue"),
  RATE_LIMIT_SECONDS: z
    .string()
    .default("20")
    .transform((s) => Number(s))
    .pipe(z.number().int().positive()),

  // Redis
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z
    .string()
    .default("6379")
    .transform((s) => Number(s))
    .pipe(z.number().int().positive()),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z
    .string()
    .optional()
    .transform((v) => (v ? v === "true" : false)),
});

export type AppEnv = z.infer<typeof EnvSchema> & {
  DISCORD_CHANNEL_IDS: Record<string, string>;
};

export function loadEnv(): AppEnv {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  return parsed.data as AppEnv;
}


