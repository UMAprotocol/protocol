import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.string().default("8080"),
  NODE_ENV: z.string().default("development"),

  // Discord bot auth
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_CHANNEL_ID: z.string().min(1, "DISCORD_CHANNEL_ID is required"),

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

  // Worker runtime
  WORKER_MODE: z.enum(["daemon", "job"]).default("daemon"),
  WORKER_JOB_IDLE_GRACE_SECONDS: z
    .string()
    .default("30")
    .transform((s) => Number(s))
    .pipe(z.number().int().nonnegative()),
  WORKER_JOB_CHECK_INTERVAL_SECONDS: z
    .string()
    .default("5")
    .transform((s) => Number(s))
    .pipe(z.number().int().positive()),
  WORKER_JOB_MAX_RUNTIME_SECONDS: z
    .string()
    .optional()
    .transform((s) => (s ? Number(s) : undefined))
    .superRefine((v, ctx) => {
      if (v === undefined) return;
      if (!Number.isInteger(v) || v <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WORKER_JOB_MAX_RUNTIME_SECONDS must be a positive integer",
        });
      }
    }),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(): AppEnv {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  return parsed.data as AppEnv;
}
